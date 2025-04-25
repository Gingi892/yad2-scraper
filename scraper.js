const cheerio = require('cheerio');
const Telenode = require('telenode-js');
const fs = require('fs');
const config = require('./config.json');
const twilio = require('twilio');

const getYad2Response = async (url) => {
    const requestOptions = {
        method: 'GET',
        redirect: 'follow'
    };
    try {
        const res = await fetch(url, requestOptions)
        return await res.text()
    } catch (err) {
        console.log(err)
    }
}

const scrapeItemsAndExtractImgUrls = async (url) => {
    const yad2Html = await getYad2Response(url);
    if (!yad2Html) {
        throw new Error("Could not get Yad2 response");
    }
    const $ = cheerio.load(yad2Html);
    const title = $("title")
    const titleText = title.first().text();
    if (titleText === "ShieldSquare Captcha") {
        throw new Error("Bot detection");
    }
    const $feedItems = $(".feeditem").find(".pic");
    if (!$feedItems) {
        throw new Error("Could not find feed items");
    }
    const imageUrls = []
    $feedItems.each((_, elm) => {
        const imgSrc = $(elm).find("img").attr('src');
        if (imgSrc) {
            imageUrls.push(imgSrc)
        }
    })
    return imageUrls;
}

const checkIfHasNewItem = async (imgUrls, topic) => {
    const filePath = `./data/${topic}.json`;
    let savedUrls = [];
    try {
        savedUrls = require(filePath);
    } catch (e) {
        if (e.code === "MODULE_NOT_FOUND") {
            fs.mkdirSync('data', { recursive: true });
            fs.writeFileSync(filePath, '[]');
        } else {
            console.log(e);
            throw new Error(`Could not read / create ${filePath}`);
        }
    }
    let shouldUpdateFile = false;
    savedUrls = savedUrls.filter(savedUrl => {
        shouldUpdateFile = true;
        return imgUrls.includes(savedUrl);
    });
    const newItems = [];
    imgUrls.forEach(url => {
        if (!savedUrls.includes(url)) {
            savedUrls.push(url);
            newItems.push(url);
            shouldUpdateFile = true;
        }
    });
    if (shouldUpdateFile) {
        const updatedUrls = JSON.stringify(savedUrls, null, 2);
        fs.writeFileSync(filePath, updatedUrls);
        await createPushFlagForWorkflow();
    }
    return newItems;
}

const createPushFlagForWorkflow = () => {
    fs.writeFileSync("push_me", "")
}

const sendWhatsappMessage = async (text) => {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_WHATSAPP_FROM; // Twilio Sandbox Number
    const to = process.env.TWILIO_WHATSAPP_TO; // Your verified number

    if (!accountSid || !authToken || !from || !to) {
        console.warn("Missing Twilio environment variables, skipping WhatsApp send.");
        return;
    }

    const client = twilio(accountSid, authToken);

    try {
        const message = await client.messages.create({
            from: `whatsapp:${from}`,
            to: `whatsapp:${to}`,
            body: text
        });
        console.log("WhatsApp message sent via Twilio:", message.sid);
    } catch (error) {
        console.error("Failed to send WhatsApp message via Twilio:", error.message);
    }
}

const scrape = async (topic, url) => {
    const apiToken = process.env.API_TOKEN || config.telegramApiToken;
    const chatId = process.env.CHAT_ID || config.chatId;
    const telenode = new Telenode({apiToken})

    try {
        const intro = `Starting scanning ${topic} on link:\n${url}`;
        await telenode.sendTextMessage(intro, chatId)
        await sendWhatsappMessage(intro);

        const scrapeImgResults = await scrapeItemsAndExtractImgUrls(url);
        const newItems = await checkIfHasNewItem(scrapeImgResults, topic);

        if (newItems.length > 0) {
            const newItemsJoined = newItems.join("\n----------\n");
            const msg = `${newItems.length} new items for ${topic}:\n${newItemsJoined}`;
            await telenode.sendTextMessage(msg, chatId);
            await sendWhatsappMessage(msg);
        } else {
            const noNewMsg = `No new items were added for ${topic}`;
            await telenode.sendTextMessage(noNewMsg, chatId);
            await sendWhatsappMessage(noNewMsg);
        }

    } catch (e) {
        const errMsg = `Scan workflow failed... 😥\n${e?.message || e}`;
        await telenode.sendTextMessage(errMsg, chatId);
        await sendWhatsappMessage(errMsg);
        throw new Error(e)
    }
}

const program = async () => {
    await Promise.all(config.projects.filter(project => {
        if (project.disabled) {
            console.log(`Topic "${project.topic}" is disabled. Skipping.`);
        }
        return !project.disabled;
    }).map(async project => {
        await scrape(project.topic, project.url)
    }))
};

program();
