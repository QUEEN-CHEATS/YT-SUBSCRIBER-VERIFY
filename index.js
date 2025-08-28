const { Client, Events, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, InteractionType } = require('discord.js');
const Tesseract = require('tesseract.js');
const sharp = require('sharp');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const fs = require('fs');
const config = require("./config.js");

// ---------------- Config Validation -----------------
if (!config.token) {
    console.error('Error: Bot token is required in config.js');
    process.exit(1);
}
if (!config.channel_name) {
    console.error('Error: Channel name is required in config.js');
    process.exit(1);
}

const role_id = config.role_id || null;
const save_data = config.save_data === 'true';

// ---------------- Client Setup -----------------
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// ---------------- Slash Command Setup -----------------
client.once(Events.ClientReady, async readyClient => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);

    const commands = [
        new SlashCommandBuilder()
            .setName('verify')
            .setDescription('Analyze an image for text')
            .addAttachmentOption(option => 
                option.setName('image')
                    .setDescription('The image to analyze')
                    .setRequired(true)),
        new SlashCommandBuilder()
            .setName('sublist')
            .setDescription('Show list of verified subscribers (Owner Only)')
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(config.token);

    try {
        console.log('Started refreshing application (/) commands.');
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
});

// ---------------- Utility Functions -----------------
const normalize = (str = "") => str.replace(/\s+/g, " ").replace(/[’'`]/g, "'").toUpperCase().trim();

const isOwnChannel = (text) => {
    const normText = normalize(text);
    const allowTokens = [
        config.channel_name,
        config.channel_id
    ].filter(Boolean).map(normalize);
    return allowTokens.some(token => normText.includes(token));
};

const hasSubscribeWord = (text) => normalize(text).includes("SUBSCRIBED");

const isUserVerified = (userId) => {
    if (!fs.existsSync('subscriber.json')) return false;
    try {
        const subscribers = JSON.parse(fs.readFileSync('subscriber.json'));
        return subscribers.some(subscriber => subscriber.id === userId);
    } catch (err) {
        console.error('subscriber.json is corrupted, resetting...', err);
        fs.writeFileSync('subscriber.json', '[]');
        return false;
    }
};

// ---------------- Verification Core -----------------
async function runVerification(buffer, member, channel, replyFn) {
    try {
        const processedImage = await sharp(buffer).resize({ width: 1000 }).toBuffer();
        const { data: { text } } = await Tesseract.recognize(processedImage);
        console.log(`Extracted text: ${text}`);
        const normalizedText = normalize(text);

        let isVerified = false;
        if (config.exact_channel_only) {
            if (isOwnChannel(normalizedText) && hasSubscribeWord(normalizedText)) {
                isVerified = true;
            }
        } else {
            if (isOwnChannel(normalizedText) || hasSubscribeWord(normalizedText)) {
                isVerified = true;
            }
        }

        if (isVerified) {
            if (role_id) await member.roles.add(role_id);

            const successEmbed = new EmbedBuilder()
                .setTitle("🎉 Verification Successful!")
                .setDescription(`💝 Thanks for subscribing to **${config.channel_name}**.\n💌 You have been given SUBSCRIBER role. Enjoy your stay!`)
                .setColor("Green")
                .setFooter({ text: "DEVELOPED BY KHUSHI •" })
                .setTimestamp();

            await replyFn({ embeds: [successEmbed] });

            if (save_data) {
                const userData = {
                    username: member.user.username,
                    id: member.user.id,
                    time: new Date().toISOString(),
                    accountCreated: member.user.createdAt.toISOString()
                };
                let subscribers = [];
                if (fs.existsSync('subscriber.json')) {
                    subscribers = JSON.parse(fs.readFileSync('subscriber.json'));
                }
                subscribers.push(userData);
                fs.writeFileSync('subscriber.json', JSON.stringify(subscribers, null, 2));
            }

        } else {
            const errorEmbed = new EmbedBuilder()
                .setTitle("❌ Verification Failed")
                .setDescription(
                    `⚠️ You haven't subscribed to **${config.channel_name}** or your screenshot is invalid.\n\n` +
                    `👉 GO AND SUBSCRIBE 🔴 **[${config.channel_name}](${config.channel_link})**\n\n` +
                    `📷 Send the screenshot like below.`
                )
                .setColor("Red")
                .setFooter({ text: "DEVELOPED BY KHUSHI •" })
                .setTimestamp()
                .setImage("https://i.ibb.co/mVVrXQqH/subscriber.png");

            await replyFn({ embeds: [errorEmbed] });
        }
    } catch (error) {
        console.error('Error processing the image:', error);
        const errorEmbed = new EmbedBuilder()
            .setTitle("❌ Processing Error")
            .setDescription("❌There was an error processing the image. Please try again.")
            .setColor("Red")
            .setFooter({ text: "DEVELOPED BY KHUSHI •" })
            .setTimestamp();

        await replyFn({ embeds: [errorEmbed] });
    }
}

// ---------------- Pagination Helper -----------------
function paginate(array, pageSize) {
    const pages = [];
    for (let i = 0; i < array.length; i += pageSize) {
        pages.push(array.slice(i, i + pageSize));
    }
    return pages;
}

// ---------------- Command Handling -----------------
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isCommand()) return;

    const member = interaction.member;

    // ---------- verify command ----------
    if (interaction.commandName === 'verify') {
        await interaction.deferReply({ ephemeral: false });

        if (!member) {
            const errorEmbed = new EmbedBuilder()
                .setTitle("❌ Error")
                .setDescription("Member not found.")
                .setColor("Red")
                .setFooter({ text: "DEVELOPED BY KHUSHI •" })
                .setTimestamp();

            await interaction.followUp({ embeds: [errorEmbed] });
            return;
        }

        if (isUserVerified(member.user.id)) {
            const alreadyEmbed = new EmbedBuilder()
                .setTitle("✅ Already Verified")
                .setDescription("You are already verified.")
                .setColor("Green")
                .setFooter({ text: "DEVELOPED BY KHUSHI •" })
                .setTimestamp();

            await interaction.followUp({ embeds: [alreadyEmbed] });
            return;
        }

        const image = interaction.options.getAttachment('image');
        if (!image || !image.url) {
            const noImageEmbed = new EmbedBuilder()
                .setTitle("❌ No Image Provided")
                .setDescription("Please provide a valid image (JPG, PNG, WEBP, or GIF).")
                .setColor("Red")
                .setFooter({ text: "DEVELOPED BY KHUSHI •" })
                .setTimestamp();

            await interaction.followUp({ embeds: [noImageEmbed] });
            return;
        }

        try {
            const response = await fetch(image.url);
            const buffer = Buffer.from(await response.arrayBuffer());
            await runVerification(buffer, member, interaction.channel, (msg) => interaction.followUp(msg));
        } catch (err) {
            console.error(err);
        }
    }

    // ---------- sublist command with pagination ----------
    if (interaction.commandName === 'sublist') {
        const ownerId = config.owner_id; 
        if (interaction.user.id !== ownerId) {
            return interaction.reply({ content: '❌ You cannot use this command!', ephemeral: true });
        }

        if (!fs.existsSync('subscriber.json')) {
            return interaction.reply({ content: '📭 No verified subscribers yet.', ephemeral: true });
        }

        let subscribers = [];
        try {
            subscribers = JSON.parse(fs.readFileSync('subscriber.json'));
        } catch {
            subscribers = [];
        }

        if (subscribers.length === 0) {
            return interaction.reply({ content: '📭 No verified subscribers yet.', ephemeral: true });
        }

        const usersArray = subscribers.map(u => `${u.username} (${u.id})`);
        const pages = paginate(usersArray, 10);
        let page = 0;

        const embed = new EmbedBuilder()
            .setColor("#0099ff")
            .setTitle(`📋 Verified Subscribers (Page ${page + 1}/${pages.length})`)
            .setDescription(pages[page].join("\n"))
            .setFooter({ text: `Total: ${subscribers.length}` })
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId('prev').setLabel('⬅️ Prev').setStyle(ButtonStyle.Primary).setDisabled(true),
                new ButtonBuilder().setCustomId('next').setLabel('Next ➡️').setStyle(ButtonStyle.Primary).setDisabled(pages.length === 1)
            );

        const msg = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });

        const collector = msg.createMessageComponentCollector({ time: 120000 });
        collector.on('collect', i => {
            if (i.user.id !== ownerId) return i.reply({ content: "❌ Not allowed.", ephemeral: true });

            if (i.customId === 'prev' && page > 0) page--;
            if (i.customId === 'next' && page < pages.length - 1) page++;

            const newEmbed = new EmbedBuilder()
                .setColor("#0099ff")
                .setTitle(`📋 Verified Subscribers (Page ${page + 1}/${pages.length})`)
                .setDescription(pages[page].join("\n"))
                .setFooter({ text: `Total: ${subscribers.length}` })
                .setTimestamp();

            i.update({
                embeds: [newEmbed],
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('prev').setLabel('⬅️ Prev').setStyle(ButtonStyle.Primary).setDisabled(page === 0),
                        new ButtonBuilder().setCustomId('next').setLabel('Next ➡️').setStyle(ButtonStyle.Primary).setDisabled(page === pages.length - 1)
                    )
                ]
            });
        });
    }
});

// ---------------- Direct Image Upload -----------------
client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    if (message.attachments.size > 0) {
        const attachment = message.attachments.first();
        const member = await message.guild.members.fetch(message.author.id).catch(() => null);
        if (!member) return;

        try {
            const response = await fetch(attachment.url);
            const buffer = Buffer.from(await response.arrayBuffer());
            await runVerification(buffer, member, message.channel, (msg) => message.reply(msg));
        } catch (err) {
            console.error(err);
        }
    }

    // Auto Channel Link reply
    const content = message.content.toLowerCase();
    if (content.includes("link") || content.includes("yt link") || content.includes("chanel link") || content.includes("channel link")) {
        const replyEmbed = new EmbedBuilder()
            .setTitle("🔴 Official YouTube Channel")
            .setDescription(
                `📺 Subscribe Now: **[${config.channel_name}](${config.channel_link})**\n\n` +
                ` Don't forget to turn on 🔔 notifications!`
            )
            .setColor("Blue")
            .setImage("https://i.ibb.co/mVVrXQqH/subscriber.png")
            .setFooter({ text: "DEVELOPED BY KHUSHI •" })
            .setTimestamp();

        await message.reply({ embeds: [replyEmbed] });
    }
});

// ---------------- Keep Alive Server -----------------
const express = require("express");
const app = express();
app.get("/", (req, res) => res.send("✅ Bot is Alive and Running!"));
app.listen(3000, () => console.log("🌐 KeepAlive server is running on port 3000"));

client.login(config.token).catch(err => console.error('Failed to login:', err));
