import cron from 'node-cron';
import prisma from '../utils/prisma';
import { sendPushNotification, NotificationBuilders } from './pushNotification.service';

export function startCronJobs() {
  // Check for tasks due in 24 hours — runs every hour
  cron.schedule('0 * * * *', async () => {
    console.log('⏰ Checking for due-soon tasks...');
    try {
      const now = new Date();
      const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const in23h = new Date(now.getTime() + 23 * 60 * 60 * 1000);

      const dueSoonTasks = await prisma.task.findMany({
        where: {
          dueDate: { gte: in23h, lte: in24h },
          status: { notIn: ['DONE', 'CANCELLED'] },
        },
        select: { id: true, title: true, assignedToId: true, dueDate: true },
      });

      for (const task of dueSoonTasks) {
        const hoursLeft = Math.round(
          (task.dueDate!.getTime() - now.getTime()) / (60 * 60 * 1000)
        );
        await sendPushNotification(
          task.assignedToId,
          NotificationBuilders.taskDueSoon(task.id, task.title, hoursLeft)
        );
      }

      console.log(`✅ Sent ${dueSoonTasks.length} due-soon notifications`);
    } catch (error) {
      console.error('Due-soon cron error:', error);
    }
  });

  // Check for overdue tasks — runs every 6 hours
  cron.schedule('0 */6 * * *', async () => {
    console.log('🚨 Checking for overdue tasks...');
    try {
      const now = new Date();

      const overdueTasks = await prisma.task.findMany({
        where: {
          dueDate: { lt: now },
          status: { notIn: ['DONE', 'CANCELLED'] },
        },
        select: {
          id: true, title: true,
          assignedToId: true, createdById: true,
        },
      });

      for (const task of overdueTasks) {
        const notifyIds = [task.assignedToId, task.createdById]
          .filter((id, i, arr) => arr.indexOf(id) === i);

        for (const userId of notifyIds) {
          await sendPushNotification(
            userId,
            NotificationBuilders.taskOverdue(task.id, task.title)
          );
        }
      }

      console.log(`✅ Sent overdue notifications for ${overdueTasks.length} tasks`);
    } catch (error) {
      console.error('Overdue cron error:', error);
    }
  });

  // Clean up old notifications — runs daily at 2am
  cron.schedule('0 2 * * *', async () => {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const deleted = await prisma.notification.deleteMany({
        where: { createdAt: { lt: thirtyDaysAgo }, read: true },
      });
      console.log(`🧹 Cleaned up ${deleted.count} old notifications`);
    } catch (error) {
      console.error('Cleanup cron error:', error);
    }
  });

  // Clean up expired refresh tokens — runs daily at 3am
  cron.schedule('0 3 * * *', async () => {
    try {
      const deleted = await prisma.refreshToken.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      console.log(`🧹 Cleaned up ${deleted.count} expired refresh tokens`);
    } catch (error) {
      console.error('Token cleanup error:', error);
    }
  });

  console.log('✅ Cron jobs started');
}
