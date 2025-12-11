require('dotenv').config();
const { Client, GatewayIntentBits, Partials, REST, Routes, ActivityType, ChannelType } = require('discord.js');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// Configuración de subida de archivos (Memoria RAM)
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 8 * 1024 * 1024 } // Máximo 8MB
});

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;       
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET; 
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CALLBACK_URL = 'http://localhost:3000/auth/discord/callback';

const settingsPath = path.join(__dirname, 'settings.json');
let guildConfigs = {};

// Aumentar límite de datos para recibir imágenes grandes
const jsonParser = bodyParser.json({ limit: '50mb' });
const urlencodedParser = bodyParser.urlencoded({ extended: true, limit: '50mb' });

if (fs.existsSync(settingsPath)) {
    try { guildConfigs = JSON.parse(fs.readFileSync(settingsPath)); } catch (e) { console.error("Error config"); }
}

function saveConfig() {
    fs.writeFileSync(settingsPath, JSON.stringify(guildConfigs, null, 2));
}

function getGuildConfig(guildId) {
    if (!guildConfigs[guildId]) {
        guildConfigs[guildId] = {
            prefix: "!",
            botNickname: "Habbus",
            botAvatar: "", 
            embedColor: "#ff0f0f",
            welcomeEnabled: false,
            welcomeChannel: "",
            welcomeMessage: "¡Bienvenido {user} a {server}!",
            botStatus: "online",
            activityType: 0,
            activityText: "Navidad en Habbus"
        };
    }
    return guildConfigs[guildId];
}

const commands = [ { name: 'ping', description: '🏓 Latencia' }, { name: 'habbus', description: '🎄 Info' } ];

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

client.on('guildMemberAdd', member => {
    const config = getGuildConfig(member.guild.id);
    if (config.welcomeEnabled && config.welcomeChannel) {
        const channel = member.guild.channels.cache.get(config.welcomeChannel);
        if (channel) {
            channel.send({
                content: config.welcomeMessage.replace('{user}', `<@${member.id}>`).replace('{server}', member.guild.name),
                embeds: [{ description: "Gracias por unirte.", color: parseInt(config.embedColor.replace("#", ""), 16) }]
            });
        }
    }
});

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
passport.use(new DiscordStrategy({
    clientID: CLIENT_ID, clientSecret: CLIENT_SECRET, callbackURL: CALLBACK_URL, scope: ['identify', 'guilds']
}, (a, r, p, d) => process.nextTick(() => d(null, p))));

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
    let channels = [];
    if (!selectedGuildId && adminServers.length > 0) selectedGuildId = adminServers[0].id;
    if (selectedGuildId) {
        const guild = client.guilds.cache.get(selectedGuildId);
        if (guild) channels = guild.channels.cache.filter(c => c.type === ChannelType.GuildText).map(c => ({ id: c.id, name: c.name }));
    }
    const config = getGuildConfig(selectedGuildId);
    res.render('dashboard', { user: req.user, config: config, stats: { servers: client.guilds.cache.size, ping: Math.round(client.ws.ping), status: 'En Línea' }, servers: adminServers, selectedGuildId: selectedGuildId, channels: channels });
});

// --- RUTA DE GUARDADO (SOLUCIÓN DEL ERROR) ---
app.post('/save-config', upload.single('botAvatarFile'), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(403).send("No auth");
    
    const guildId = req.body.guildId;
    if (!guildId) return res.status(400).send("Falta ID");

    let current = guildConfigs[guildId] || {};
    
    // Guardar textos
    if(req.body.prefix) current.prefix = req.body.prefix;
    if(req.body.welcomeMessage) current.welcomeMessage = req.body.welcomeMessage;
    if(req.body.welcomeChannel) current.welcomeChannel = req.body.welcomeChannel;
    if(req.body.embedColor) current.embedColor = req.body.embedColor;
    if(req.body.botNickname) current.botNickname = req.body.botNickname;
    
    // Estado
    current.botStatus = req.body.botStatus;
    current.activityType = req.body.activityType;
    current.activityText = req.body.activityText;
    
    if(req.body.welcomeEnabled !== undefined) current.welcomeEnabled = (req.body.welcomeEnabled === 'on');

    // Procesar Imagen
    let newAvatarDataURI = null;
    if (req.file) {
        console.log("📁 Imagen recibida, convirtiendo...");
        const base64String = req.file.buffer.toString('base64');
        const mimeType = req.file.mimetype;
        newAvatarDataURI = `data:${mimeType};base64,${base64String}`;
        current.botAvatar = newAvatarDataURI; // Guardar en config
    }

    guildConfigs[guildId] = current;
    saveConfig();

    // --- APLICAR CAMBIOS EN DISCORD ---
    
    // 1. Estado Global
    try {
        client.user.setPresence({
            status: req.body.botStatus || 'online',
            activities: [{ type: parseInt(req.body.activityType || 0), name: req.body.activityText || 'Habbus' }]
        });
        console.log("✅ Estado actualizado");
    } catch (e) { console.error(e); }

    // 2. Cambios Locales (SOLUCIÓN AL ERROR)
    const guild = client.guilds.cache.get(guildId);
    if (guild) {
        try {
            // Cambio de Apodo
            if (req.body.botNickname) await guild.members.me.setNickname(req.body.botNickname);
            
            // Cambio de Avatar (USANDO .edit() EN LUGAR DE .setAvatar())
            const avatarToSet = newAvatarDataURI || current.botAvatar;
            if (avatarToSet && avatarToSet.startsWith('data:')) {
                console.log("🔄 Cambiando avatar del servidor...");
                // Aquí usamos .edit, que es más compatible y seguro
                await guild.members.me.edit({ avatar: avatarToSet });
                console.log("✅ Avatar cambiado con éxito.");
            }

        } catch (error) {
            console.error(`⚠️ Error en ${guild.name}: ${error.message}`);
            console.error("NOTA: El bot necesita permisos para cambiar apodo. Para cambiar AVATAR de SERVIDOR, el bot debe tener permisos altos o el servidor debe tener Nivel de Boost.");
        }
    }
    
    res.sendStatus(200);
});

app.listen(3000, () => console.log('🌐 Web lista en http://localhost:3000'));