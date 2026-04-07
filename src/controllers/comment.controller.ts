import { Response } from 'express';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth.middleware';
import { sendBulkPushNotifications, NotificationBuilders } from '../services/pushNotification.service';

const getVisibilityFilter = (userId: number, role: string) => {
  if (role === 'ADMIN') return {};
  return { OR: [{ createdById: userId }, { assignedToId: userId }] };
};

export const addComment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const taskId = parseInt(req.params.taskId);
    const userId = req.user!.id;
    const role = req.user!.role;
    const { content } = req.body;

    if (!content?.trim()) {
      res.status(400).json({ message: 'Comment content is required' });
      return;
    }

    // Verify task access
    const task = await prisma.task.findFirst({
      where: { id: taskId, ...getVisibilityFilter(userId, role) },
      include: {
        createdBy: { select: { id: true } },
        assignedTo: { select: { id: true } },
      },
    });

    if (!task) {
      res.status(404).json({ message: 'Task not found or access denied' });
      return;
    }

    const comment = await prisma.comment.create({
      data: { content: content.trim(), taskId, userId },
      include: {
        user: { select: { id: true, name: true, avatar: true } },
      },
    });

    await prisma.activityLog.create({
      data: { userId, taskId, action: 'COMMENT_ADDED', details: { commentId: comment.id } },
    });

    // Notify creator & assignee (except commenter)
    const notifyIds = [task.createdById, task.assignedToId]
      .filter((id, i, arr) => arr.indexOf(id) === i && id !== userId);

    if (notifyIds.length > 0) {
      await sendBulkPushNotifications(
        notifyIds,
        NotificationBuilders.commentAdded(taskId, task.title, req.user!.name)
      );
    }

    res.status(201).json({ message: 'Comment added', comment });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const updateComment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const commentId = parseInt(req.params.id);
    const userId = req.user!.id;
    const { content } = req.body;

    const comment = await prisma.comment.findUnique({ where: { id: commentId } });

    if (!comment) {
      res.status(404).json({ message: 'Comment not found' });
      return;
    }

    if (comment.userId !== userId) {
      res.status(403).json({ message: 'Can only edit your own comments' });
      return;
    }

    // 5-minute edit window
    const editWindowMs = 5 * 60 * 1000;
    if (Date.now() - comment.createdAt.getTime() > editWindowMs) {
      res.status(403).json({ message: 'Edit window has expired (5 minutes)' });
      return;
    }

    const updated = await prisma.comment.update({
      where: { id: commentId },
      data: { content: content.trim(), editedAt: new Date() },
      include: { user: { select: { id: true, name: true, avatar: true } } },
    });

    res.json({ message: 'Comment updated', comment: updated });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const deleteComment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const commentId = parseInt(req.params.id);
    const userId = req.user!.id;
    const role = req.user!.role;

    const comment = await prisma.comment.findUnique({ where: { id: commentId } });

    if (!comment) {
      res.status(404).json({ message: 'Comment not found' });
      return;
    }

    if (role !== 'ADMIN' && comment.userId !== userId) {
      res.status(403).json({ message: 'Can only delete your own comments' });
      return;
    }

    await prisma.comment.delete({ where: { id: commentId } });

    await prisma.activityLog.create({
      data: {
        userId,
        taskId: comment.taskId,
        action: 'COMMENT_DELETED',
        details: { commentId },
      },
    });

    res.json({ message: 'Comment deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
};
