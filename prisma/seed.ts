import { PrismaClient, Role, TaskStatus, Priority } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create admin user
  const adminPassword = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@taskmaster.com' },
    update: {},
    create: {
      email: 'admin@taskmaster.com',
      name: 'Admin User',
      passwordHash: adminPassword,
      role: Role.ADMIN,
    },
  });

  // Create regular users
  const userPassword = await bcrypt.hash('user123', 10);
  const user1 = await prisma.user.upsert({
    where: { email: 'alice@taskmaster.com' },
    update: {},
    create: {
      email: 'alice@taskmaster.com',
      name: 'Alice Johnson',
      passwordHash: userPassword,
      role: Role.USER,
    },
  });

  const user2 = await prisma.user.upsert({
    where: { email: 'bob@taskmaster.com' },
    update: {},
    create: {
      email: 'bob@taskmaster.com',
      name: 'Bob Smith',
      passwordHash: userPassword,
      role: Role.USER,
    },
  });

  const user3 = await prisma.user.upsert({
    where: { email: 'carol@taskmaster.com' },
    update: {},
    create: {
      email: 'carol@taskmaster.com',
      name: 'Carol Davis',
      passwordHash: userPassword,
      role: Role.USER,
    },
  });

  // Create sample tasks
  const task1 = await prisma.task.create({
    data: {
      title: 'Design new landing page',
      description: 'Create wireframes and mockups for the new marketing landing page',
      status: TaskStatus.IN_PROGRESS,
      priority: Priority.HIGH,
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdById: admin.id,
      assignedToId: user1.id,
    },
  });

  const task2 = await prisma.task.create({
    data: {
      title: 'Fix authentication bug',
      description: 'Users are being logged out unexpectedly after 10 minutes',
      status: TaskStatus.PENDING,
      priority: Priority.URGENT,
      dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      createdById: user1.id,
      assignedToId: user2.id,
    },
  });

  const task3 = await prisma.task.create({
    data: {
      title: 'Write API documentation',
      description: 'Document all REST endpoints with request/response examples',
      status: TaskStatus.PENDING,
      priority: Priority.MEDIUM,
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      createdById: user2.id,
      assignedToId: user3.id,
    },
  });

  const task4 = await prisma.task.create({
    data: {
      title: 'Set up CI/CD pipeline',
      description: 'Configure GitHub Actions for automated testing and deployment',
      status: TaskStatus.DONE,
      priority: Priority.HIGH,
      completedAt: new Date(),
      dueDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      createdById: admin.id,
      assignedToId: user2.id,
    },
  });

  // Add some comments
  await prisma.comment.create({
    data: {
      content: 'I have started working on the wireframes. Will share a draft by EOD.',
      taskId: task1.id,
      userId: user1.id,
    },
  });

  await prisma.comment.create({
    data: {
      content: 'Looking great! Please include mobile responsive designs.',
      taskId: task1.id,
      userId: admin.id,
    },
  });

  await prisma.comment.create({
    data: {
      content: 'I can reproduce the bug. It seems related to the JWT expiry handling.',
      taskId: task2.id,
      userId: user2.id,
    },
  });

  // Activity logs
  await prisma.activityLog.createMany({
    data: [
      { userId: admin.id, taskId: task1.id, action: 'TASK_CREATED', details: { title: task1.title } },
      { userId: user1.id, taskId: task1.id, action: 'TASK_STATUS_CHANGED', details: { from: 'PENDING', to: 'IN_PROGRESS' } },
      { userId: user1.id, taskId: task2.id, action: 'TASK_CREATED', details: { title: task2.title } },
      { userId: admin.id, taskId: task4.id, action: 'TASK_CREATED', details: { title: task4.title } },
      { userId: user2.id, taskId: task4.id, action: 'TASK_STATUS_CHANGED', details: { from: 'IN_PROGRESS', to: 'DONE' } },
    ],
  });

  console.log('✅ Seed complete!');
  console.log('\n📋 Test Accounts:');
  console.log('  Admin:  admin@taskmaster.com / admin123');
  console.log('  Alice:  alice@taskmaster.com / user123');
  console.log('  Bob:    bob@taskmaster.com   / user123');
  console.log('  Carol:  carol@taskmaster.com / user123');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
