import { Expo, ExpoPushMessage, ExpoPushTicket, ExpoPushReceiptId } from 'expo-server-sdk';
import { sendWhatsAppNotification } from '../services/whatsapp.service';
import prisma from '../utils/prisma';
import { NotificationType } from '@prisma/client';

const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });

const pendingReceiptIds: ExpoPushReceiptId[] = [];

interface NotificationPayload {
  title: string;
  body: string;
  type: NotificationType;
  data?: Record<string, any>;
}

// ─── NEW: Get all admin user IDs ───────────────────────────────────────────────
async function getAdminUserIds(): Promise<number[]> {
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN', isActive: true },
    select: { id: true },
  });
  return admins.map(a => a.id);
}

// ─── NEW: Resolve all recipients (assignee + assigner + admins, deduped) ──────
async function resolveRecipients(
  assignedToId?: number | null,
  createdById?: number | null,
  excludeUserId?: number | null  // don't notify the person who triggered the action
): Promise<number[]> {
  const adminIds = await getAdminUserIds();

  const allIds = [
    ...(assignedToId ? [assignedToId] : []),
    ...(createdById ? [createdById] : []),
    ...adminIds,
  ];

  // Deduplicate and optionally exclude the actor
  return [...new Set(allIds)].filter(id => id !== excludeUserId);
}

// ─── Core send to a single user (unchanged logic) ─────────────────────────────
export async function sendPushNotification(
  userId: number,
  payload: NotificationPayload
): Promise<void> {
  try {
    console.log(`--- 🔔 START NOTIFICATION ATTEMPT for User ID: ${userId} ---`);

    const dbNotif = await prisma.notification.create({
      data: {
        userId,
        title: payload.title,
        body: payload.body,
        type: payload.type,
        data: payload.data || {},
      },
    });
    console.log(`✅ [Step 1] Saved to DB. Notification ID: ${dbNotif.id}`);

    const whatsappMessage = `🔔 *${payload.title}*\n\n${payload.body}\n\n_Check the app for more details._`;
    sendWhatsAppNotification(userId, whatsappMessage).catch(err =>
      console.error(`❌ WhatsApp background error:`, err)
    );

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { expoPushToken: true, name: true },
    });

    if (!user?.expoPushToken) {
      console.log(`⚠️  [Step 2] No push token for ${user?.name || userId} — Mobile Push skipped.`);
      return;
    }

    if (!Expo.isExpoPushToken(user.expoPushToken)) {
      console.warn(`❌ [Step 3] INVALID token for user ${userId}. Clearing.`);
      await prisma.user.update({ where: { id: userId }, data: { expoPushToken: null } });
      return;
    }

    const message: ExpoPushMessage = {
      to: user.expoPushToken,
      sound: 'default',
      title: payload.title,
      body: payload.body,
      data: { ...payload.data, notificationId: dbNotif.id },
      priority: 'high',
      badge: 1,
      channelId: 'default',
      categoryId: payload.type,
    };

    const chunks = expo.chunkPushNotifications([message]);
    for (const chunk of chunks) {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      for (const ticket of tickets) {
        if (ticket.status === 'ok') {
          pendingReceiptIds.push(ticket.id);
        } else {
          console.error(`❌ [Step 5] Expo REJECTED:`, ticket);
          if ((ticket as any).details?.error === 'DeviceNotRegistered') {
            await prisma.user.update({ where: { id: userId }, data: { expoPushToken: null } });
          }
        }
      }
    }

  } catch (error: any) {
    console.error(`💥 sendPushNotification THREW for user ${userId}:`, error?.message || error);
  }
}

// ─── NEW: Send to multiple users at once ──────────────────────────────────────
export async function sendPushNotificationToMany(
  userIds: number[],
  payload: NotificationPayload
): Promise<void> {
  if (userIds.length === 0) return;
  console.log(`📣 Sending "${payload.title}" to ${userIds.length} user(s): [${userIds.join(', ')}]`);
  await Promise.allSettled(userIds.map(uid => sendPushNotification(uid, payload)));
}

export async function sendBulkPushNotifications(
  userIds: number[],
  payload: NotificationPayload
): Promise<void> {
  await sendPushNotificationToMany(userIds, payload);
}

export async function checkPushReceipts(): Promise<void> {
  if (pendingReceiptIds.length === 0) return;

  const ids = pendingReceiptIds.splice(0, pendingReceiptIds.length);
  console.log(`🧾 Checking ${ids.length} push receipt(s)...`);

  try {
    const chunks = expo.chunkPushNotificationReceiptIds(ids);
    for (const chunk of chunks) {
      const receipts = await expo.getPushNotificationReceiptsAsync(chunk);
      for (const [receiptId, receipt] of Object.entries(receipts)) {
        if (receipt.status === 'ok') {
          console.log(`✅ Receipt ${receiptId}: delivered`);
        } else {
          console.error(`❌ Receipt ${receiptId}: FAILED`, receipt);
        }
      }
    }
  } catch (err: any) {
    console.error('Error checking receipts:', err?.message);
  }
}

// ─── Notification payload builders ────────────────────────────────────────────
export const NotificationBuilders = {
  taskAssigned: (taskId: number, taskTitle: string) => ({
    title: '📋 New Task Assigned',
    body: `You've been assigned: "${taskTitle}"`,
    type: 'TASK_ASSIGNED' as NotificationType,
    data: { taskId, screen: 'TaskDetail' },
  }),

  taskReassigned: (taskId: number, taskTitle: string, newAssigneeName: string) => ({
    title: '🔄 Task Reassigned',
    body: `"${taskTitle}" was reassigned to ${newAssigneeName}`,
    type: 'TASK_REASSIGNED' as NotificationType,
    data: { taskId, screen: 'TaskDetail' },
  }),

  taskCompleted: (taskId: number, taskTitle: string, completedBy: string) => ({
    title: '✅ Task Completed',
    body: `"${taskTitle}" was marked done by ${completedBy}`,
    type: 'TASK_COMPLETED' as NotificationType,
    data: { taskId, screen: 'TaskDetail' },
  }),

  commentAdded: (taskId: number, taskTitle: string, commenterName: string) => ({
    title: '💬 New Comment',
    body: `${commenterName} commented on "${taskTitle}"`,
    type: 'COMMENT_ADDED' as NotificationType,
    data: { taskId, screen: 'TaskDetail' },
  }),

  taskDueSoon: (taskId: number, taskTitle: string, hoursLeft: number) => ({
    title: '⏰ Task Due Soon',
    body: `"${taskTitle}" is due in ${hoursLeft} hour${hoursLeft !== 1 ? 's' : ''}`,
    type: 'TASK_DUE_SOON' as NotificationType,
    data: { taskId, screen: 'TaskDetail' },
  }),

  taskOverdue: (taskId: number, taskTitle: string) => ({
    title: '🚨 Task Overdue',
    body: `"${taskTitle}" is now overdue!`,
    type: 'TASK_OVERDUE' as NotificationType,
    data: { taskId, screen: 'TaskDetail' },
  }),

  statusChanged: (taskId: number, taskTitle: string, newStatus: string, changedBy: string) => ({
    title: '🔄 Status Updated',
    body: `${changedBy} changed "${taskTitle}" → ${newStatus.replace('_', ' ')}`,
    type: 'STATUS_CHANGED' as NotificationType,
    data: { taskId, screen: 'TaskDetail' },
  }),
};

// ─── NEW: Smart dispatch — resolves recipients automatically from a task ───────
/**
 * Use this in your task controllers instead of sendPushNotification().
 * It automatically sends to: assignee + assigner (createdBy) + all admins.
 *
 * @param taskId       - The task ID to look up assignee/assigner from
 * @param payload      - Notification payload (use NotificationBuilders)
 * @param actorUserId  - The user who triggered the action (excluded from receiving)
 */
export async function notifyTaskParticipants(
  taskId: number,
  payload: NotificationPayload,
  actorUserId?: number
): Promise<void> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { assignedToId: true, createdById: true },
    });

    if (!task) {
      console.warn(`⚠️  notifyTaskParticipants: Task ${taskId} not found`);
      return;
    }

    const recipients = await resolveRecipients(
      task.assignedToId,
      task.createdById,
      actorUserId
    );

    await sendPushNotificationToMany(recipients, payload);
  } catch (err: any) {
    console.error(`💥 notifyTaskParticipants error:`, err?.message);
  }
}