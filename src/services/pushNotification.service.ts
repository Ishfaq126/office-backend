import { Expo, ExpoPushMessage, ExpoPushTicket, ExpoPushReceiptId } from 'expo-server-sdk';
import { sendWhatsAppNotification } from '../services/whatsapp.service';
import prisma from '../utils/prisma';
import { NotificationType } from '@prisma/client';

const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });

// In-memory store of ticket IDs to check receipts for (flush every 15 min in prod)
const pendingReceiptIds: ExpoPushReceiptId[] = [];

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
    console.log(`--- 🔔 START NOTIFICATION ATTEMPT for User ID: ${userId} ---`);

    // 1. Always save to DB so in-app notifications work regardless of push
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

    // 🟢 NEW: [Step 1.5] Trigger WhatsApp Message
    // Formatting the message with *stars* makes the title Bold in WhatsApp
    const whatsappMessage = `🔔 *${payload.title}*\n\n${payload.body}\n\n_Check the app for more details._`;
    
    // We don't necessarily need to 'await' this if we want the push logic to continue immediately
    sendWhatsAppNotification(userId, whatsappMessage).catch(err => 
      console.error(`❌ WhatsApp background error:`, err)
    );

    // 2. Get user's push token for Expo
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { expoPushToken: true, name: true },
    });

    if (!user?.expoPushToken) {
      console.log(`⚠️  [Step 2] No push token for ${user?.name || userId} — Mobile Push skipped (WhatsApp sent).`);
      return;
    }
    console.log(`📱 [Step 2] Found Token for ${user.name}: ${user.expoPushToken}`);

    // 3. Validate token format
    if (!Expo.isExpoPushToken(user.expoPushToken)) {
      console.warn(`❌ [Step 3] INVALID token format for user ${userId}. Clearing from DB.`);
      await prisma.user.update({ where: { id: userId }, data: { expoPushToken: null } });
      return;
    }
    console.log(`✅ [Step 3] Token format is valid.`);

    // 4. Build the message
    const message: ExpoPushMessage = {
      to: user.expoPushToken,
      sound: 'default',
      title: payload.title,
      body: payload.body,
      data: { ...payload.data, notificationId: dbNotif.id },
      priority: 'high',
      badge: 1,
      channelId: 'default', // Matches Android Channel ID
      categoryId: payload.type, // Matches iOS Category ID
    };

    console.log(`📤 [Step 4] Sending request to Expo servers...`);
    const chunks = expo.chunkPushNotifications([message]);

    for (const chunk of chunks) {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      console.log(`🎫 [Step 5] Expo Response Received:`, JSON.stringify(tickets, null, 2));

      for (const ticket of tickets) {
        if (ticket.status === 'ok') {
          console.log(`🚀 [Step 5] Success! Ticket ID: ${ticket.id}`);
          pendingReceiptIds.push(ticket.id);
        } else {
          console.error(`❌ [Step 5] Expo REJECTED ticket:`, ticket);
          
          // Handle specific Expo errors
          if ((ticket as any).details?.error === 'DeviceNotRegistered') {
            console.warn(`🗑️  Clearing stale token for user ${userId}`);
            await prisma.user.update({ where: { id: userId }, data: { expoPushToken: null } });
          }
        }
      }
    }
    console.log(`--- 🔔 END PUSH ATTEMPT ---`);
    
  } catch (error: any) {
    console.error(`💥 sendPushNotification THREW:`, error?.message || error);
  }
}

/**
 * Check Expo push receipts for previously-sent tickets.
 * Receipts tell you whether FCM/APNs actually delivered the notification.
 * Call this ~15 minutes after sending — Expo holds receipts for 24h.
 */
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
          console.log(`✅ Receipt ${receiptId}: delivered successfully`);
        } else {
          console.error(`❌ Receipt ${receiptId}: FAILED`, receipt);
          // receipt.details.error values:
          // DeviceNotRegistered — token no longer valid
          // MessageRateExceeded — too many messages
          // MismatchSenderId   — wrong FCM sender
          // InvalidCredentials — FCM/APNs key expired
        }
      }
    }
  } catch (err: any) {
    console.error('Error checking receipts:', err?.message);
  }
}

export async function sendBulkPushNotifications(
  userIds: number[],
  payload: NotificationPayload
): Promise<void> {
  await Promise.allSettled(userIds.map(uid => sendPushNotification(uid, payload)));
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