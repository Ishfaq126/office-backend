// @ts-ignore
import qrcode from 'qrcode-terminal';
import { Client, LocalAuth } from 'whatsapp-web.js';
import prisma from '../utils/prisma';

const BROWSERLESS_URL = process.env.BROWSERLESS_URL || 'wss://office-task-manager-browserless.aeju8m.easypanel.host?token=a40c35559490b56663af216630193297';

const whatsappClient = new Client({
    authStrategy: new LocalAuth({
        dataPath: './.wwebjs_auth'
    }),
    puppeteer: {
        browserWSEndpoint: BROWSERLESS_URL,
        handleSIGINT: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--single-process'
        ],
    }
});

whatsappClient.on('qr', (qr) => {
    console.log('📱 SCAN THIS QR CODE WITH WHATSAPP:');
    qrcode.generate(qr, { small: true });
});

whatsappClient.on('ready', () => {
    console.log('✅ WhatsApp Client is ready!');
});

whatsappClient.on('auth_failure', (msg) => console.error('❌ WA Auth Failure:', msg));
whatsappClient.on('disconnected', (reason) => console.log('❌ WA Disconnected:', reason));

whatsappClient.initialize().catch(err => {
    console.error('💥 WhatsApp Initialization Failed:', err.message);
});

export async function sendWhatsAppNotification(userId: number, message: string) {
    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { phoneNumber: true }
        });

        if (!user?.phoneNumber) return;

        const cleanNumber = user.phoneNumber.replace(/\D/g, '');
        const chatId = `${cleanNumber}@c.us`;

        await whatsappClient.sendMessage(chatId, message);
        console.log(`📨 WhatsApp sent to ${user.phoneNumber}`);
    } catch (error) {
        console.error('❌ WhatsApp Send Error:', error);
    }
}