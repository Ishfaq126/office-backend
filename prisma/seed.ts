import { PrismaClient, Role, TaskStatus, Priority } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🗑️ Deleting previous data...');
  // Delete in order to respect foreign key constraints
  await prisma.activityLog.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.task.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.user.deleteMany();

  console.log('🌱 Seeding database with phone numbers...');

  const adminPassword = await bcrypt.hash('admin123', 10);
  const userPassword = await bcrypt.hash('user123', 10);

  // 1. Create Admin (Ishfaq)
  const admin = await prisma.user.create({
    data: {
      email: 'admin@gmail.com',
      name: 'Ishfaq (Admin)',
      passwordHash: adminPassword,
      role: Role.ADMIN,
      phoneNumber: '923337881264', // Cleaned format for WhatsApp
    },
  });

  // 2. Create Regular Users
  const user1 = await prisma.user.create({
    data: {
      email: 'usama@gmail.com',
      name: 'Usama',
      passwordHash: userPassword,
      role: Role.USER,
      phoneNumber: '923705106055',
    },
  });

  const user2 = await prisma.user.create({
    data: {
      email: 'azib@gmail.com',
      name: 'Azib',
      passwordHash: userPassword,
      role: Role.USER,
      phoneNumber: '923705106055',
    },
  });

  const user3 = await prisma.user.create({
    data: {
      email: 'jawad@gmail.com',
      name: 'Jawad',
      passwordHash: userPassword,
      role: Role.USER,
      phoneNumber: '923705106055',
    },
  });

  // 3. Create sample tasks
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

  // 4. Activity logs
  await prisma.activityLog.createMany({
    data: [
      { userId: admin.id, taskId: task1.id, action: 'TASK_CREATED', details: { title: task1.title } },
      { userId: user1.id, taskId: task1.id, action: 'TASK_STATUS_CHANGED', details: { from: 'PENDING', to: 'IN_PROGRESS' } },
    ],
  });

  console.log('✅ Seed complete!');
  console.log('\n📋 Updated Test Accounts:');
  console.log(`  Admin:  ${admin.email} / admin123 (WA: ${admin.phoneNumber})`);
  console.log(`  Usama:  ${user1.email} / user123  (WA: ${user1.phoneNumber})`);
  console.log(`  Azib:   ${user2.email} / user123  (WA: ${user2.phoneNumber})`);
  console.log(`  Jawad:  ${user3.email} / user123  (WA: ${user3.phoneNumber})`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());