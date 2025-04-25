const cheerio = require('cheerio');
const Telenode = require('telenode-js');
const fs = require('fs');
const config = require('./config.json');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const getYad2Response = async (url) => {
    try {
        const res = await fetch(url, { method: 'GET', redirect: 'follow' });
        return await res.text();
    } catch (err) {
        console.error("Failed to fetch page:", err.message);
    }
};

const parseFeedItems = ($, url) => {
    const feedItems = [];
    $(".feeditem").each((_, el) => {
        const type = url.includes("rent") ? "להשכרה" : "למכירה";
        const link = $(el).attr("href");
        const fullLink = `https://www.yad2.co.il${link}`;
        const title = $(el).find(".title").text().trim();
        const rooms = $(el).find(".rooms").text().trim();
        const price = $(el).find(".price").text().trim();
        const address = $(el).find(".subtitle").text().trim();
        const [street = "", number = ""] = address.split(" ");
        
        feedItems.push({
            id: fullLink.split("/").pop(),
            fullLink,
            type,
            street,
            number,
            rooms,
            price
        });
    });
    return feedItems;
};

const checkIfHasNewItems = async (items, topic) => {
    const filePath = `./data/${topic}.json`;
    let savedIds = [];
    try {
        savedIds = require(filePath);
    } catch (e) {
        if (e.code === "MODULE_NOT_FOUND") {
            fs.mkdirSync('data', { recursive: true });
            fs.writeFileSync(filePath, '[]');
        } else {
            throw new Error(`Could not read / create ${filePath}`);
        }
    }

    const newItems = items.filter(item => !savedIds.includes(item.id));
    if (newItems.length > 0) {
        const updatedIds = [...savedIds, ...newItems.map(item => item.id)];
        fs.writeFileSync(filePath, JSON.stringify(updatedIds, null, 2));
    }

    return newItems;
};

const formatMessage = (items) => {
    const header = `נמצאו ${items.length} מודעות חדשות:\n`;
    const body = items.map(item => {
        return `${item.type} / ${item.street} / ${item.number} / ${item.rooms} / ${item.price}\n🔗 ${item.fullLink}`;
    }).join("\n\n");
    return header + body;
};

const sendTelegramMessage = async (text) => {
    const apiToken = process.env.API_TOKEN || config.telegramApiToken;
    const chatId = process.env.CHAT_ID || config.chatId;
    const telenode = new Telenode({ apiToken });

    try {
        await telenode.sendTextMessage(text, chatId);
    } catch (err) {
        console.error("Telegram send error:", err.message);
    }
};

const scrape = async (topic, url) => {
    try {
        const html = await getYad2Response(url);
        const $ = cheerio.load(html);
        const items = parseFeedItems($, url);
        const newItems = await checkIfHasNewItems(items, topic);

        if (newItems.length > 0) {
            const message = formatMessage(newItems);
            await sendTelegramMessage(message);
        }
    } catch (e) {
        console.error(`Error while scraping "${topic}":`, e.message);
    }
};

const program = async () => {
    await Promise.all(config.projects.filter(project => !project.disabled).map(async project => {
        await scrape(project.topic, project.url);
    }));
};

program();
