require('dotenv').config();
const { Client, GatewayIntentBits, Partials, REST, Routes, ActivityType, ChannelType, PermissionFlagsBits } = require('discord.js');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const storage = multer.memoryStorage();
const upload = multer({ storage: storage, limits: { fileSize: 8 * 1024 * 1024 } });

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;       
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET; 
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CALLBACK_URL = 'http://localhost:3000/auth/discord/callback';

const settingsPath = path.join(__dirname, 'settings.json');
let guildConfigs = {};

const jsonParser = bodyParser.json({ limit: '50mb' });
const urlencodedParser = bodyParser.urlencoded({ extended: true, limit: '50mb' });

if (fs.existsSync(settingsPath)) {
    try { guildConfigs = JSON.parse(fs.readFileSync(settingsPath)); } catch (e) { console.error("Error config"); }
}

function saveConfig() { fs.writeFileSync(settingsPath, JSON.stringify(guildConfigs, null, 2)); }

function getGuildConfig(guildId) {
    if (!guildConfigs[guildId]) {
        guildConfigs[guildId] = {
            prefix: "!", language: "es", timezone: "America/Bogota",
            ignoredChannels: [], ephemeralReplies: false,
            botNickname: "Habbus", botAvatar: "", embedColor: "#ff0f0f",
            botStatus: "online", activityType: 0, activityText: "Navidad en Habbus",
            welcomeEnabled: false, welcomeChannel: "", welcomeMessage: "¡Bienvenido {user} a {server}!",
            // AHORA SON ARRAYS (LISTAS) PARA SOPORTAR MÚLTIPLES ROLES
            adminRole: [], 
            modRole: [], 
            muteRole: "", // Mute sigue siendo uno solo para evitar errores al castigar
            automodBadWords: false, automodLinks: false,
            logChannel: "", logMessages: false, logMembers: false
        };
    }
    return guildConfigs[guildId];
}

const commands = [
    { name: 'ping', description: '🏓 Latencia' },
    { name: 'habbus', description: '🎄 Info' },
    { name: 'ban', description: '🔨 Banear', options: [{ name: 'usuario', type: 6, required: true }, { name: 'razon', type: 3 }] },
    { name: 'kick', description: '🦶 Expulsar', options: [{ name: 'usuario', type: 6, required: true }, { name: 'razon', type: 3 }] },
    { name: 'mute', description: '😶 Silenciar', options: [{ name: 'usuario', type: 6, required: true }, { name: 'minutos', type: 4, required: true }, { name: 'razon', type: 3 }] }
];

const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
    partials: [Partials.Channel, Partials.Message]
});

client.once('ready', async () => {
    console.log(`🎄 HabbusBot listo como ${client.user.tag}`);
    try { await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands }); } catch (e) {}
    client.user.setPresence({ activities: [{ name: 'Navidad en Habbus', type: ActivityType.Playing }], status: 'online' });
});

// --- HELPER: Verificar si tiene ALGUNO de los roles permitidos ---
// Esta función revisa si el usuario tiene al menos UNO de los roles de la lista
function checkRoles(member, allowedRolesIds) {
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true; // Admin de Discord siempre pasa
    if (!allowedRolesIds || !Array.isArray(allowedRolesIds) || allowedRolesIds.length === 0) return false;
    // .some() devuelve true si al menos uno cumple la condición
    return member.roles.cache.some(r => allowedRolesIds.includes(r.id));
}

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, options, guild, user, member, channelId } = interaction;
    const config = getGuildConfig(guild.id);

    if (config.ignoredChannels && config.ignoredChannels.includes(channelId)) return interaction.reply({ content: '🚫 Desactivado aquí.', ephemeral: true });
    
    const replyOptions = (c) => ({ content: c, ephemeral: config.ephemeralReplies });
    const sendLog = (t, color, d) => { if (config.logChannel) { const ch = guild.channels.cache.get(config.logChannel); if (ch) ch.send({ embeds: [{ title: t, description: d, color: color, footer: { text: `Mod: ${user.tag}` } }] }); } };

    if (commandName === 'ping') return interaction.reply(replyOptions(`¡Pong! ${client.ws.ping}ms`));
    if (commandName === 'habbus') return interaction.reply(replyOptions('🎅 **HabbusBot** v2.0'));

    // --- COMANDOS DE MODERACIÓN (LÓGICA MULTI-ROL) ---
    if (commandName === 'ban') {
        // Puede banear si tiene CUALQUIERA de los roles de Admin O Mod
        if (!checkRoles(member, config.adminRole) && !checkRoles(member, config.modRole)) return interaction.reply({ content: '⛔ Sin permisos.', ephemeral: true });
        
        const target = options.getUser('usuario');
        const reason = options.getString('razon') || 'Sin razón';
        try { await guild.members.ban(target, { reason }); interaction.reply(replyOptions(`🔨 **${target.tag}** baneado.`)); sendLog('🔨 Ban', 0xff0000, `User: ${target.tag}\nRazón: ${reason}`); } catch { interaction.reply({ content: '❌ Error.', ephemeral: true }); }
    }

    if (commandName === 'kick') {
        if (!checkRoles(member, config.modRole)) return interaction.reply({ content: '⛔ Sin permisos.', ephemeral: true });
        const target = options.getUser('usuario');
        const reason = options.getString('razon') || 'Sin razón';
        try { const m = await guild.members.fetch(target.id); await m.kick(reason); interaction.reply(replyOptions(`🦶 **${target.tag}** expulsado.`)); sendLog('🦶 Kick', 0xffa500, `User: ${target.tag}\nRazón: ${reason}`); } catch { interaction.reply({ content: '❌ Error.', ephemeral: true }); }
    }

    if (commandName === 'mute') {
        if (!checkRoles(member, config.modRole)) return interaction.reply({ content: '⛔ Sin permisos.', ephemeral: true });
        const target = options.getUser('usuario');
        const min = options.getInteger('minutos');
        const reason = options.getString('razon') || 'Sin razón';
        try { const m = await guild.members.fetch(target.id); await m.timeout(min * 60 * 1000, reason); interaction.reply(replyOptions(`😶 **${target.tag}** muteado (${min}m).`)); sendLog('😶 Mute', 0xffff00, `User: ${target.tag}\nTime: ${min}m`); } catch { interaction.reply({ content: '❌ Error.', ephemeral: true }); }
    }
});

// AUTOMOD (También actualizado para respetar multi-roles)
const badWords = ['tonto', 'estupido', 'idiota', 'mierda']; 
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    const config = getGuildConfig(message.guild.id);
    if (config.ignoredChannels && config.ignoredChannels.includes(message.channel.id)) return;
    
    // Si tiene CUALQUIER rol de admin o mod, ignora el automod
    if(checkRoles(message.member, config.adminRole) || checkRoles(message.member, config.modRole)) return; 

    if (config.automodBadWords && badWords.some(w => message.content.toLowerCase().includes(w))) { await message.delete(); message.channel.send(`🚫 ${message.author}, lenguaje.`).then(m => setTimeout(() => m.delete(), 5000)); }
    if (config.automodLinks && message.content.includes('discord.gg/')) { await message.delete(); message.channel.send(`🚫 ${message.author}, no spam.`).then(m => setTimeout(() => m.delete(), 5000)); }
});

// Resto de eventos (Delete, Add, Remove)
client.on('messageDelete', async message => { if (!message.guild || message.author.bot) return; const config = getGuildConfig(message.guild.id); if (config.logMessages && config.logChannel) { const ch = message.guild.channels.cache.get(config.logChannel); if (ch) ch.send(`🗑️ **Borrado**\n👤 ${message.author.tag}\n💬 ${message.content}`); } });
client.on('guildMemberAdd', member => { const config = getGuildConfig(member.guild.id); if (config.welcomeEnabled && config.welcomeChannel) { const ch = member.guild.channels.cache.get(config.welcomeChannel); if (ch) ch.send(config.welcomeMessage.replace('{user}', `<@${member.id}>`)); } if (config.logMembers && config.logChannel) { const ch = member.guild.channels.cache.get(config.logChannel); if (ch) ch.send(`🟢 Entrada: ${member.user.tag}`); } });
client.on('guildMemberRemove', member => { const config = getGuildConfig(member.guild.id); if (config.logMembers && config.logChannel) { const ch = member.guild.channels.cache.get(config.logChannel); if (ch) ch.send(`🔴 Salida: ${member.user.tag}`); } });

client.login(BOT_TOKEN);

// WEB SERVER
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(jsonParser);
app.use(urlencodedParser);
app.use(session({ secret: 'navidad', resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));
passport.use(new DiscordStrategy({ clientID: CLIENT_ID, clientSecret: CLIENT_SECRET, callbackURL: CALLBACK_URL, scope: ['identify', 'guilds'] }, (a, r, p, d) => process.nextTick(() => d(null, p))));
app.get('/', (req, res) => res.render('index', { user: req.user }));
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => res.redirect('/dashboard'));
app.get('/logout', (req, res) => { req.logout(() => res.redirect('/')); });
app.get('/invite', (req, res) => res.redirect(`https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&scope=bot%20applications.commands`));

app.get('/dashboard', async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/');
    const userGuilds = req.user.guilds || [];
    const adminServers = userGuilds.filter(g => (BigInt(g.permissions) & 0x8n) === 0x8n);
    let selectedGuildId = req.query.guild;
    let channels = [], roles = [];
    if (!selectedGuildId && adminServers.length > 0) selectedGuildId = adminServers[0].id;
    if (selectedGuildId) {
        const guild = client.guilds.cache.get(selectedGuildId);
        if (guild) {
            try {
                channels = guild.channels.cache.filter(c => c.type === ChannelType.GuildText).map(c => ({ id: c.id, name: c.name }));
                const r = await guild.roles.fetch();
                roles = r.filter(ro => ro.name !== '@everyone').sort((a, b) => b.position - a.position).map(ro => ({ id: ro.id, name: ro.name, color: ro.hexColor }));
            } catch(e) {}
        }
    }
    const config = getGuildConfig(selectedGuildId);
    res.render('dashboard', { user: req.user, config, stats: { servers: client.guilds.cache.size, ping: 0, status: 'Online' }, servers: adminServers, selectedGuildId, channels, roles });
});

// GUARDAR CONFIGURACIÓN ACTUALIZADA
app.post('/save-config', upload.single('botAvatarFile'), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(403).send("No auth");
    const guildId = req.body.guildId;
    if (!guildId) return res.status(400).send("Falta ID");
    let current = guildConfigs[guildId] || {};

    // Helper para guardar Arrays (Roles Multiples)
    // Si viene solo un valor es string, si vienen varios es array. Convertimos todo a array.
    const saveArray = (val) => {
        if (!val) return [];
        return Array.isArray(val) ? val : [val];
    };
    
    current.adminRole = saveArray(req.body.adminRole);
    current.modRole = saveArray(req.body.modRole);
    current.ignoredChannels = saveArray(req.body.ignoredChannels);
    
    // Mute rol es único (string)
    if(req.body.muteRole !== undefined) current.muteRole = req.body.muteRole;

    ['prefix', 'language', 'timezone', 'welcomeMessage', 'welcomeChannel', 'embedColor', 'botNickname', 'logChannel', 'botStatus', 'activityText'].forEach(f => { if(req.body[f] !== undefined) current[f] = req.body[f]; });
    current.activityType = parseInt(req.body.activityType || 0);
    ['welcomeEnabled', 'automodBadWords', 'automodLinks', 'logMessages', 'logMembers', 'ephemeralReplies'].forEach(f => { current[f] = req.body[f] === 'on'; });
    
    if (req.file) current.botAvatar = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    
    guildConfigs[guildId] = current;
    saveConfig();
    
    const guild = client.guilds.cache.get(guildId);
    if(guild) {
        try { if(req.body.botNickname) await guild.members.me.setNickname(req.body.botNickname); } catch(e){}
        try { if(current.botAvatar && current.botAvatar.startsWith('data:')) await guild.members.me.edit({ avatar: current.botAvatar }); } catch(e){}
        try { client.user.setPresence({ status: current.botStatus, activities: [{ type: parseInt(current.activityType), name: current.activityText }] }); } catch(e){}
    }
    res.sendStatus(200);
});

app.listen(3000, () => console.log('🌐 Web lista'));