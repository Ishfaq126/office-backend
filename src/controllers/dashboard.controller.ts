import { Response } from 'express';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth.middleware';

export const getDashboardStats = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const role = req.user!.role;

    if (role === 'ADMIN') {
      await getAdminStats(req, res);
    } else {
      await getUserStats(userId, res);
    }
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

async function getAdminStats(req: AuthRequest, res: Response) {
  const now = new Date();

  const [
    totalTasks,
    tasksByStatus,
    tasksByPriority,
    overdueCount,
    recentTasks,
    topAssignees,
    completionTrend,
    totalUsers,
    recentActivity,
  ] = await Promise.all([
    prisma.task.count(),
    prisma.task.groupBy({
      by: ['status'],
      _count: { status: true },
    }),
    prisma.task.groupBy({
      by: ['priority'],
      _count: { priority: true },
    }),
    prisma.task.count({
      where: {
        dueDate: { lt: now },
        status: { not: 'DONE' },
      },
    }),
    prisma.task.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, name: true, avatar: true } },
        assignedTo: { select: { id: true, name: true, avatar: true } },
      },
    }),
    prisma.task.groupBy({
      by: ['assignedToId'],
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 5,
    }),
    // Last 7 days completion trend
    prisma.$queryRaw`
      SELECT DATE(completed_at) as date, COUNT(*) as count
      FROM tasks
      WHERE completed_at >= NOW() - INTERVAL '7 days'
      AND status = 'DONE'
      GROUP BY DATE(completed_at)
      ORDER BY date
    `,
    prisma.user.count({ where: { isActive: true } }),
    prisma.activityLog.findMany({
      take: 20,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, avatar: true } },
        task: { select: { id: true, title: true } },
      },
    }),
  ]);

  // Hydrate assignee names
  const assigneeIds = topAssignees.map(a => a.assignedToId);
  const assigneeUsers = await prisma.user.findMany({
    where: { id: { in: assigneeIds } },
    select: { id: true, name: true, avatar: true },
  });

  const topAssigneesWithNames = topAssignees.map(a => ({
    user: assigneeUsers.find(u => u.id === a.assignedToId),
    taskCount: a._count.id,
  }));

  const totalDone = tasksByStatus.find(s => s.status === 'DONE')?._count.status || 0;
  const completionRate = totalTasks > 0 ? Math.round((totalDone / totalTasks) * 100) : 0;

  res.json({
    role: 'ADMIN',
    overview: {
      totalTasks,
      totalUsers,
      completionRate,
      overdueCount,
    },
    tasksByStatus: tasksByStatus.map(s => ({
      status: s.status,
      count: s._count.status,
    })),
    tasksByPriority: tasksByPriority.map(p => ({
      priority: p.priority,
      count: p._count.priority,
    })),
    topAssignees: topAssigneesWithNames,
    recentTasks,
    completionTrend,
    recentActivity,
  });
}

async function getUserStats(userId: number, res: Response) {
  const now = new Date();

  const [
    assignedByStatus,
    createdByStatus,
    recentTasks,
    overdueAssigned,
    upcomingTasks,
  ] = await Promise.all([
    prisma.task.groupBy({
      by: ['status'],
      where: { assignedToId: userId },
      _count: { status: true },
    }),
    prisma.task.groupBy({
      by: ['status'],
      where: { createdById: userId },
      _count: { status: true },
    }),
    prisma.task.findMany({
      where: { OR: [{ assignedToId: userId }, { createdById: userId }] },
      take: 10,
      orderBy: { updatedAt: 'desc' },
      include: {
        createdBy: { select: { id: true, name: true, avatar: true } },
        assignedTo: { select: { id: true, name: true, avatar: true } },
      },
    }),
    prisma.task.count({
      where: {
        assignedToId: userId,
        dueDate: { lt: now },
        status: { not: 'DONE' },
      },
    }),
    prisma.task.findMany({
      where: {
        assignedToId: userId,
        dueDate: {
          gte: now,
          lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        },
        status: { not: 'DONE' },
      },
      orderBy: { dueDate: 'asc' },
      take: 5,
      include: {
        createdBy: { select: { id: true, name: true, avatar: true } },
      },
    }),
  ]);

  const getCount = (arr: any[], status: string) =>
    arr.find(s => s.status === status)?._count.status || 0;

  const totalAssigned = assignedByStatus.reduce((acc, s) => acc + s._count.status, 0);
  const doneAssigned = getCount(assignedByStatus, 'DONE');
  const completionRate = totalAssigned > 0 ? Math.round((doneAssigned / totalAssigned) * 100) : 0;

  res.json({
    role: 'USER',
    assigned: {
      total: totalAssigned,
      pending: getCount(assignedByStatus, 'PENDING'),
      inProgress: getCount(assignedByStatus, 'IN_PROGRESS'),
      done: doneAssigned,
      cancelled: getCount(assignedByStatus, 'CANCELLED'),
    },
    created: {
      total: createdByStatus.reduce((acc, s) => acc + s._count.status, 0),
      pending: getCount(createdByStatus, 'PENDING'),
      inProgress: getCount(createdByStatus, 'IN_PROGRESS'),
      done: getCount(createdByStatus, 'DONE'),
    },
    completionRate,
    overdueCount: overdueAssigned,
    recentTasks,
    upcomingTasks,
  });
}

export const getActivityLog = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (req.user!.role !== 'ADMIN') {
      res.status(403).json({ message: 'Admin only' });
      return;
    }

    const { page = '1', limit = '50' } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const logs = await prisma.activityLog.findMany({
      skip,
      take: parseInt(limit as string),
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, avatar: true } },
        task: { select: { id: true, title: true } },
      },
    });

    res.json({ logs });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
};
