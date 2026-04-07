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
  console.log(`\n--- 🔔 START PUSH ATTEMPT for User ID: ${userId} ---`);
  
  try {
    // 1. Check Database Insertion
    const newNotification = await prisma.notification.create({
      data: {
        userId,
        title: payload.title,
        body: payload.body,
        type: payload.type,
        data: payload.data || {},
      },
    });
    console.log(`✅ [Step 1] Saved to DB. Notification ID: ${newNotification.id}`);

    // 2. Fetch User and Token
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { expoPushToken: true, name: true },
    });

    if (!user) {
      console.error(`❌ [Step 2] User ${userId} not found in database!`);
      return;
    }

    if (!user.expoPushToken) {
      console.warn(`⚠️ [Step 2] User "${user.name}" (ID: ${userId}) has NO push token stored.`);
      return;
    }
    console.log(`📱 [Step 2] Found Token for ${user.name}: ${user.expoPushToken.substring(0, 20)}...`);

    // 3. Validate Token Format
    if (!Expo.isExpoPushToken(user.expoPushToken)) {
      console.error(`❌ [Step 3] Token is NOT a valid Expo Push Token: ${user.expoPushToken}`);
      // Clear invalid token
      await prisma.user.update({
        where: { id: userId },
        data: { expoPushToken: null },
      });
      return;
    }
    console.log(`✅ [Step 3] Token format is valid.`);

    // 4. Construct Message
    const message: ExpoPushMessage = {
      to: user.expoPushToken,
      sound: 'default',
      title: payload.title,
      body: payload.body,
      data: payload.data,
      priority: 'high',
      channelId: 'default',
      badge: 1,
    };

    // 5. Send to Expo
    console.log(`📤 [Step 4] Sending request to Expo servers...`);
    const chunks = expo.chunkPushNotifications([message]);

    for (const chunk of chunks) {
      try {
        const tickets: ExpoPushTicket[] = await expo.sendPushNotificationsAsync(chunk);
        console.log(`🎫 [Step 5] Expo Response Received:`, JSON.stringify(tickets, null, 2));

        for (const ticket of tickets) {
          if (ticket.status === 'error') {
            console.error('🔴 [Step 5] Expo Error Ticket:', ticket.message);
            if (ticket.details?.error === 'DeviceNotRegistered') {
              console.warn('🗑️ Device not registered. Removing token from DB.');
              await prisma.user.update({
                where: { id: userId },
                data: { expoPushToken: null },
              });
            }
          } else {
            console.log('🚀 [Step 5] Success! Ticket ID:', ticket.id);
          }
        }
      } catch (err) {
        console.error('❌ [Step 5] Network Error sending push chunk:', err);
      }
    }
    console.log(`--- 🔔 END PUSH ATTEMPT --- \n`);
  } catch (error) {
    console.error('❌ CRITICAL ERROR in sendPushNotification:', error);
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
