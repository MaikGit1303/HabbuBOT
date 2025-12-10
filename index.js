require('dotenv').config();
const { Client, GatewayIntentBits, Partials, REST, Routes, ActivityType, ChannelType } = require('discord.js');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

// --- DATOS ---
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;       
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET; 
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CALLBACK_URL = 'http://localhost:3000/auth/discord/callback';

// --- CONFIGURACIÓN MULTI-SERVIDOR ---
const settingsPath = path.join(__dirname, 'settings.json');
let guildConfigs = {};

// Cargar configs
if (fs.existsSync(settingsPath)) {
    try { guildConfigs = JSON.parse(fs.readFileSync(settingsPath)); } catch (e) { console.error("Error leyendo config"); }
}

function saveConfig() {
    fs.writeFileSync(settingsPath, JSON.stringify(guildConfigs, null, 2));
}

// Obtener config de un server (o crear default)
function getGuildConfig(guildId) {
    if (!guildConfigs[guildId]) {
        guildConfigs[guildId] = {
            prefix: "!",
            welcomeEnabled: false,
            welcomeChannel: "",
            welcomeMessage: "¡Bienvenido {user} a {server}!"
        };
    }
    return guildConfigs[guildId];
}

// --- COMANDOS Y CLIENTE ---
const commands = [
    { name: 'ping', description: '🏓 Latencia' },
    { name: 'habbus', description: '🎄 Info del bot' }
];

const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
    partials: [Partials.Channel, Partials.Message]
});

client.once('ready', async () => {
    console.log(`🎄 HabbusBot listo como ${client.user.tag}`);
    try { await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands }); } catch (e) {}
    client.user.setPresence({ activities: [{ name: '🎄 Navidad', type: ActivityType.Playing }], status: 'online' });
});

// EVENTO DE BIENVENIDA REAL
client.on('guildMemberAdd', member => {
    const config = getGuildConfig(member.guild.id);
    
    // Si está activado y hay canal configurado
    if (config.welcomeEnabled && config.welcomeChannel) {
        const channel = member.guild.channels.cache.get(config.welcomeChannel);
        if (channel) {
            let msg = config.welcomeMessage
                .replace('{user}', `<@${member.id}>`)
                .replace('{server}', member.guild.name);
            channel.send(msg);
        }
    }
});

// Comandos
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === 'ping') await interaction.reply(`Pong! ${client.ws.ping}ms`);
});

client.login(BOT_TOKEN);

// --- WEB DASHBOARD ---
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
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

// RUTA DASHBOARD INTELIGENTE
app.get('/dashboard', async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/');

    const userGuilds = req.user.guilds || [];
    const adminServers = userGuilds.filter(g => (BigInt(g.permissions) & 0x8n) === 0x8n);

    // Detectar qué servidor está seleccionando el usuario (por URL ?guild=ID)
    let selectedGuildId = req.query.guild;
    let selectedGuild = null;
    let channels = [];

    // Si no hay ID en la URL, usamos el primero de la lista
    if (!selectedGuildId && adminServers.length > 0) {
        selectedGuildId = adminServers[0].id;
    }

    if (selectedGuildId) {
        // Verificar que el bot esté en ese servidor para sacar canales
        const guild = client.guilds.cache.get(selectedGuildId);
        if (guild) {
            // Obtener canales de texto
            channels = guild.channels.cache
                .filter(c => c.type === ChannelType.GuildText)
                .map(c => ({ id: c.id, name: c.name }));
            selectedGuild = adminServers.find(g => g.id === selectedGuildId);
        }
    }

    // Obtener config específica de ese servidor
    const config = getGuildConfig(selectedGuildId);

    res.render('dashboard', { 
        user: req.user, 
        config: config, // Configuración de ESTE servidor
        stats: { servers: client.guilds.cache.size, ping: Math.round(client.ws.ping), status: 'En Línea' },
        servers: adminServers,
        selectedGuildId: selectedGuildId, // Para que el frontend sepa cuál mostrar
        channels: channels // Lista de canales para el selector
    });
});

app.post('/save-config', (req, res) => {
    if (!req.isAuthenticated()) return res.status(403).send("No auth");
    
    const guildId = req.body.guildId;
    if (!guildId) return res.status(400).send("Falta ID de servidor");

    // Guardar en la "caja" de ese servidor específico
    guildConfigs[guildId] = {
        prefix: req.body.prefix,
        welcomeEnabled: req.body.welcomeEnabled === 'on', // Checkbox
        welcomeChannel: req.body.welcomeChannel,
        welcomeMessage: req.body.welcomeMessage
    };
    
    saveConfig();
    res.sendStatus(200);
});

app.listen(3000, () => console.log('🌐 Web lista'));