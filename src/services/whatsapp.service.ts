// @ts-ignore
import qrcode from 'qrcode-terminal';
import { Client, LocalAuth } from 'whatsapp-web.js';
import prisma from '../utils/prisma'; // Adjust path based on your folders

const whatsappClient = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        browserWSEndpoint: 'ws://office-task-manager-browserless.aeju8m.easypanel.host/chromium',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }
});

whatsappClient.on('qr', (qr) => {
    console.log('📱 SCAN THIS QR CODE WITH WHATSAPP:');
    qrcode.generate(qr, { small: true });
});

whatsappClient.on('ready', () => {
    console.log('✅ WhatsApp Client is ready!');
});

whatsappClient.initialize();

export async function sendWhatsAppNotification(userId: number, message: string) {
    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { phoneNumber: true }
        });

        if (!user?.phoneNumber) {
            console.log(`⚠️ No phone for User ${userId}`);
            return;
        }

        // Remove any non-digits (keeps 923...)
        const cleanNumber = user.phoneNumber.replace(/\D/g, '');
        const chatId = `${cleanNumber}@c.us`;

        await whatsappClient.sendMessage(chatId, message);
        console.log(`📨 WhatsApp sent to ${user.phoneNumber}`);
    } catch (error) {
        console.error('❌ WhatsApp Send Error:', error);
    }
}