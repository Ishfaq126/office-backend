import { PrismaClient, Role } from '@prisma/client';
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
      phoneNumber: '923337881264', 
    },
  });

  // 2. Create Other Users & Admins
  const user1 = await prisma.user.create({
    data: {
      email: 'usama@gmail.com',
      name: 'Usama',
      passwordHash: userPassword,
      role: Role.ADMIN,
      phoneNumber: '923705106055',
    },
  });

  const user2 = await prisma.user.create({
    data: {
      email: 'azib@gmail.com',
      name: 'Azib',
      passwordHash: userPassword,
      role: Role.USER,
      phoneNumber: '923032751945',
    },
  });

  const user3 = await prisma.user.create({
    data: {
      email: 'jawad@gmail.com',
      name: 'Jawad',
      passwordHash: userPassword,
      role: Role.ADMIN,
      phoneNumber: '923328049040',
    },
  });

  const user4 = await prisma.user.create({
    data: {
      email: 'umer@gmail.com',
      name: 'Umer',
      passwordHash: userPassword,
      role: Role.USER,
      phoneNumber: '923128720077',
    },
  });

  const user5 = await prisma.user.create({
    data: {
      email: 'atal@gmail.com',
      name: 'Atal Shah',
      passwordHash: userPassword,
      role: Role.USER,
      phoneNumber: '923138220898',
    },
  });

  const user6 = await prisma.user.create({
    data: {
      email: 'mansoor@gmail.com',
      name: 'Mansoor Ahmed',
      passwordHash: userPassword,
      role: Role.ADMIN,
      phoneNumber: '923438207678',
    },
  });

  console.log('✅ Seed complete!');
  console.log('\n📋 Updated Test Accounts:');
  console.log(`  Admin:         ${admin.email} / admin123 (WA: ${admin.phoneNumber})`);
  console.log(`  Usama:         ${user1.email} / user123  (WA: ${user1.phoneNumber})`);
  console.log(`  Azib:          ${user2.email} / user123  (WA: ${user2.phoneNumber})`);
  console.log(`  Jawad:         ${user3.email} / user123  (WA: ${user3.phoneNumber})`);
  console.log(`  Umer:          ${user4.email} / user123  (WA: ${user4.phoneNumber})`);
  console.log(`  Atal Shah:     ${user5.email} / user123  (WA: ${user5.phoneNumber})`);
  console.log(`  Mansoor Ahmed: ${user6.email} / user123  (WA: ${user6.phoneNumber})`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());