import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import * as auth from '../controllers/auth.controller';
import * as tasks from '../controllers/task.controller';
import * as comments from '../controllers/comment.controller';
import * as notifications from '../controllers/notification.controller';
import * as dashboard from '../controllers/dashboard.controller';
import * as users from '../controllers/user.controller';

const router = Router();

// Auth routes
router.post('/auth/register', auth.register);
router.post('/auth/login', auth.login);
router.post('/auth/refresh', auth.refreshToken);
router.post('/auth/logout', authenticate, auth.logout);
router.get('/auth/me', authenticate, auth.getMe);
router.put('/auth/profile', authenticate, auth.updateProfile);
router.post('/users/push-token', authenticate, auth.updatePushToken);

// User routes
router.get('/users', authenticate, users.getUsers);
router.get('/users/:id', authenticate, users.getUserById);
router.patch('/users/:id/toggle-active', authenticate, users.toggleUserActive);

// Task routes
router.get('/tasks', authenticate, tasks.getTasks);
router.post('/tasks', authenticate, tasks.createTask);
router.get('/tasks/:id', authenticate, tasks.getTask);
router.put('/tasks/:id', authenticate, tasks.updateTask);
router.patch('/tasks/:id/status', authenticate, tasks.updateTaskStatus);
router.delete('/tasks/:id', authenticate, tasks.deleteTask);

// Comment routes
router.post('/comments/tasks/:taskId', authenticate, comments.addComment);
router.put('/comments/:id', authenticate, comments.updateComment);
router.delete('/comments/:id', authenticate, comments.deleteComment);

// Notification routes
router.get('/notifications', authenticate, notifications.getNotifications);
router.patch('/notifications/:id/read', authenticate, notifications.markNotificationRead);
router.patch('/notifications/mark-all-read', authenticate, notifications.markAllRead);
router.delete('/notifications/:id', authenticate, notifications.deleteNotification);

// Dashboard
router.get('/dashboard/stats', authenticate, dashboard.getDashboardStats);
router.get('/dashboard/activity', authenticate, dashboard.getActivityLog);

export default router;
