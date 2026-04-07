import { Response } from 'express';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth.middleware';
import {
  sendPushNotification,
  sendBulkPushNotifications,
  NotificationBuilders,
} from '../services/pushNotification.service';

const isAdminOrCreator = (userId: number, createdById: number, role: string) =>
  role === 'ADMIN' || userId === createdById;

// Visibility filter: user sees tasks they created or are assigned to
const getVisibilityFilter = (userId: number, role: string) => {
  if (role === 'ADMIN') return {};
  return {
    OR: [
      { createdById: userId },
      { assignedToId: userId },
    ],
  };
};

export const getTasks = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status, priority, assignedToMe, createdByMe, search, overdue, page = '1', limit = '20' } = req.query;
    const userId = req.user!.id;
    const role = req.user!.role;

    const where: any = { ...getVisibilityFilter(userId, role) };

    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (assignedToMe === 'true') where.assignedToId = userId;
    if (createdByMe === 'true') where.createdById = userId;
    if (overdue === 'true') {
      where.dueDate = { lt: new Date() };
      where.status = { not: 'DONE' };
    }
    if (search) {
      where.OR = [
        { title: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } },
        { assignedTo: { name: { contains: search as string, mode: 'insensitive' } } },
      ];
    }

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        skip,
        take,
        orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
        include: {
          createdBy: { select: { id: true, name: true, email: true, avatar: true } },
          assignedTo: { select: { id: true, name: true, email: true, avatar: true } },
          _count: { select: { comments: true } },
        },
      }),
      prisma.task.count({ where }),
    ]);

    res.json({
      tasks,
      pagination: {
        total,
        page: parseInt(page as string),
        limit: take,
        pages: Math.ceil(total / take),
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const getTask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const taskId = parseInt(req.params.id);
    const userId = req.user!.id;
    const role = req.user!.role;

    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        ...getVisibilityFilter(userId, role),
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true, avatar: true } },
        assignedTo: { select: { id: true, name: true, email: true, avatar: true } },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: {
            user: { select: { id: true, name: true, avatar: true } },
          },
        },
      },
    });

    if (!task) {
      res.status(404).json({ message: 'Task not found or access denied' });
      return;
    }

    res.json({ task });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const createTask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title, description, assignedToId, dueDate, priority } = req.body;
    const userId = req.user!.id;

    // Verify assignee exists
    const assignee = await prisma.user.findUnique({
      where: { id: parseInt(assignedToId), isActive: true },
    });
    if (!assignee) {
      res.status(400).json({ message: 'Assignee not found' });
      return;
    }

    const task = await prisma.task.create({
      data: {
        title,
        description,
        assignedToId: parseInt(assignedToId),
        dueDate: dueDate ? new Date(dueDate) : null,
        priority: priority || 'MEDIUM',
        createdById: userId,
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true, avatar: true } },
        assignedTo: { select: { id: true, name: true, email: true, avatar: true } },
      },
    });

    // Activity log
    await prisma.activityLog.create({
      data: { userId, taskId: task.id, action: 'TASK_CREATED', details: { title } },
    });

    // Notify assignee (if not self)
    if (parseInt(assignedToId) !== userId) {
      await sendPushNotification(
        parseInt(assignedToId),
        NotificationBuilders.taskAssigned(task.id, title)
      );
    }

    res.status(201).json({ message: 'Task created', task });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const updateTask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const taskId = parseInt(req.params.id);
    const userId = req.user!.id;
    const role = req.user!.role;

    const existingTask = await prisma.task.findFirst({
      where: { id: taskId, ...getVisibilityFilter(userId, role) },
      include: { assignedTo: { select: { name: true } } },
    });

    if (!existingTask) {
      res.status(404).json({ message: 'Task not found' });
      return;
    }

    if (!isAdminOrCreator(userId, existingTask.createdById, role)) {
      res.status(403).json({ message: 'Only creator or admin can edit task details' });
      return;
    }

    const { title, description, dueDate, assignedToId, priority } = req.body;
    const updateData: any = {};

    if (title) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (dueDate !== undefined) updateData.dueDate = dueDate ? new Date(dueDate) : null;
    if (priority) updateData.priority = priority;

    let reassigned = false;
    let newAssignee: any = null;

    if (assignedToId && parseInt(assignedToId) !== existingTask.assignedToId) {
      newAssignee = await prisma.user.findUnique({ where: { id: parseInt(assignedToId) } });
      if (!newAssignee) {
        res.status(400).json({ message: 'New assignee not found' });
        return;
      }
      updateData.assignedToId = parseInt(assignedToId);
      reassigned = true;
    }

    const task = await prisma.task.update({
      where: { id: taskId },
      data: updateData,
      include: {
        createdBy: { select: { id: true, name: true, email: true, avatar: true } },
        assignedTo: { select: { id: true, name: true, email: true, avatar: true } },
      },
    });

    await prisma.activityLog.create({
      data: { userId, taskId, action: 'TASK_UPDATED', details: updateData },
    });

    if (reassigned && newAssignee) {
      await sendPushNotification(
        newAssignee.id,
        NotificationBuilders.taskAssigned(taskId, task.title)
      );
    }

    res.json({ message: 'Task updated', task });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const updateTaskStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const taskId = parseInt(req.params.id);
    const userId = req.user!.id;
    const role = req.user!.role;
    const { status } = req.body;

    const existingTask = await prisma.task.findFirst({
      where: { id: taskId, ...getVisibilityFilter(userId, role) },
      include: {
        createdBy: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true } },
      },
    });

    if (!existingTask) {
      res.status(404).json({ message: 'Task not found' });
      return;
    }

    // Status transition validation
    const validTransitions: Record<string, string[]> = {
      PENDING: ['IN_PROGRESS', 'DONE', 'CANCELLED'],
      IN_PROGRESS: ['PENDING', 'DONE', 'CANCELLED'],
      DONE: role === 'ADMIN' ? ['PENDING', 'IN_PROGRESS'] : [],
      CANCELLED: role === 'ADMIN' ? ['PENDING'] : [],
    };

    if (!validTransitions[existingTask.status]?.includes(status)) {
      res.status(400).json({
        message: `Cannot transition from ${existingTask.status} to ${status}`,
      });
      return;
    }

    const updateData: any = { status };
    if (status === 'DONE') updateData.completedAt = new Date();
    if (status !== 'DONE') updateData.completedAt = null;

    const task = await prisma.task.update({
      where: { id: taskId },
      data: updateData,
      include: {
        createdBy: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true } },
      },
    });

    await prisma.activityLog.create({
      data: {
        userId, taskId,
        action: 'TASK_STATUS_CHANGED',
        details: { from: existingTask.status, to: status },
      },
    });

    const actor = req.user!.name;

    if (status === 'DONE') {
      // Notify creator if assignee completed it
      if (userId === existingTask.assignedToId && existingTask.createdById !== userId) {
        await sendPushNotification(
          existingTask.createdById,
          NotificationBuilders.taskCompleted(taskId, task.title, actor)
        );
      }
      // Notify assignee if creator completed it
      if (userId === existingTask.createdById && existingTask.assignedToId !== userId) {
        await sendPushNotification(
          existingTask.assignedToId,
          NotificationBuilders.taskCompleted(taskId, task.title, actor)
        );
      }
    } else {
      // Status changed notification
      const notifyIds = [existingTask.createdById, existingTask.assignedToId]
        .filter((id, i, arr) => arr.indexOf(id) === i && id !== userId);

      await sendBulkPushNotifications(
        notifyIds,
        NotificationBuilders.statusChanged(taskId, task.title, status, actor)
      );
    }

    res.json({ message: 'Task status updated', task });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const deleteTask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const taskId = parseInt(req.params.id);
    const userId = req.user!.id;
    const role = req.user!.role;

    const task = await prisma.task.findFirst({
      where: { id: taskId, ...getVisibilityFilter(userId, role) },
    });

    if (!task) {
      res.status(404).json({ message: 'Task not found' });
      return;
    }

    if (!isAdminOrCreator(userId, task.createdById, role)) {
      res.status(403).json({ message: 'Only creator or admin can delete this task' });
      return;
    }

    await prisma.task.delete({ where: { id: taskId } });

    await prisma.activityLog.create({
      data: { userId, action: 'TASK_DELETED', details: { title: task.title } },
    });

    res.json({ message: 'Task deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
};
