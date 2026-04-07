import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import prisma from '../utils/prisma';
import { NotificationType } from '@prisma/client';

const expo = new Expo();

interface NotificationPayload {
  title: string;
  body: string;
  type: NotificationType;
  data?: Record<string, any>;
}

export async function sendPushNotification(
  userId: number,
  payload: NotificationPayload
): Promise<void> {
  try {
    // Save to DB first
    await prisma.notification.create({
      data: {
        userId,
        title: payload.title,
        body: payload.body,
        type: payload.type,
        data: payload.data || {},
      },
    });

    // Get user's push token
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { expoPushToken: true, name: true },
    });

    if (!user?.expoPushToken) return;

    // Validate token
    if (!Expo.isExpoPushToken(user.expoPushToken)) {
      console.warn(`Invalid Expo push token for user ${userId}: ${user.expoPushToken}`);
      // Clear invalid token
      await prisma.user.update({
        where: { id: userId },
        data: { expoPushToken: null },
      });
      return;
    }

    const message: ExpoPushMessage = {
      to: user.expoPushToken,
      sound: 'default',
      title: payload.title,
      body: payload.body,
      data: payload.data,
      priority: 'high',
      badge: 1,
    };

    const chunks = expo.chunkPushNotifications([message]);

    for (const chunk of chunks) {
      try {
        const tickets: ExpoPushTicket[] = await expo.sendPushNotificationsAsync(chunk);
        for (const ticket of tickets) {
          if (ticket.status === 'error') {
            console.error('Push notification error:', ticket.message);
            if (ticket.details?.error === 'DeviceNotRegistered') {
              await prisma.user.update({
                where: { id: userId },
                data: { expoPushToken: null },
              });
            }
          }
        }
      } catch (err) {
        console.error('Error sending push chunk:', err);
      }
    }
  } catch (error) {
    console.error('sendPushNotification error:', error);
  }
}

export async function sendBulkPushNotifications(
  userIds: number[],
  payload: NotificationPayload
): Promise<void> {
  await Promise.allSettled(
    userIds.map(userId => sendPushNotification(userId, payload))
  );
}

// Notification builders
export const NotificationBuilders = {
  taskAssigned: (taskId: number, taskTitle: string) => ({
    title: '📋 New Task Assigned',
    body: `You've been assigned: "${taskTitle}"`,
    type: 'TASK_ASSIGNED' as NotificationType,
    data: { taskId, screen: 'TaskDetail' },
  }),

  taskReassigned: (taskId: number, taskTitle: string, newAssigneeName: string) => ({
    title: '🔄 Task Reassigned',
    body: `"${taskTitle}" has been reassigned to ${newAssigneeName}`,
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
    body: `"${taskTitle}" is due in ${hoursLeft} hours`,
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
    body: `${changedBy} changed status of "${taskTitle}" to ${newStatus}`,
    type: 'STATUS_CHANGED' as NotificationType,
    data: { taskId, screen: 'TaskDetail' },
  }),
};
