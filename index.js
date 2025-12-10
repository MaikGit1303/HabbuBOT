const { Client, GatewayIntentBits, Partials, REST, Routes, ActivityType } = require('discord.js');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

// --- 🔴 TUS DATOS REALES (LLENA ESTO OTRA VEZ) ---
const CLIENT_ID = 'TU_CLIENT_ID_AQUI';       
const CLIENT_SECRET = 'TU_CLIENT_SECRET_AQUI'; 
const BOT_TOKEN = 'TU_TOKEN_DEL_BOT_AQUI';   

// --- CONFIGURACIÓN (settings.json) ---
const settingsPath = path.join(__dirname, 'settings.json');
let botConfig = {
    welcomeMessage: "¡Bienvenido al servidor, {user}!",
    prefix: "!"
};

// Cargar configuración
if (fs.existsSync(settingsPath)) {
    try {
        botConfig = JSON.parse(fs.readFileSync(settingsPath));
    } catch (e) { console.error("Error cargando config."); }
}

function saveConfig() {
    fs.writeFileSync(settingsPath, JSON.stringify(botConfig, null, 2));
}

// --- COMANDOS ---
const commands = [
    { name: 'ping', description: '🏓 Comprueba la latencia' },
    { name: 'habbus', description: '🎄 Información sobre el bot' },
    { name: 'bienvenida', description: '🧪 Prueba el mensaje de bienvenida' }
];

const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
    partials: [Partials.Channel, Partials.Message]
});

// --- EVENTOS DEL BOT ---
client.once('ready', async () => {
    console.log(`🎄 HabbusBot conectado como ${client.user.tag}`);
    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('✅ Comandos registrados.');
    } catch (error) { console.error(error); }

    // Estado Rotativo
    const activities = [
        { name: '🎄 Navidad en Habbus', type: ActivityType.Playing },
        { name: '🎁 Repartiendo Regalos', type: ActivityType.Playing },
        { name: '🛡️ Moderando', type: ActivityType.Watching },
        { name: '💻 Dashboard', type: ActivityType.Watching }
    ];
    let i = 0;
    setInterval(() => {
        if(i >= activities.length) i = 0;
        client.user.setPresence({ activities: [activities[i]], status: 'online' });
        i++;
    }, 10000);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === 'ping') await interaction.reply(`¡Pong! 🏓 ${client.ws.ping}ms`);
    if (interaction.commandName === 'habbus') await interaction.reply('🎅 **HabbusBot** v1.0');
    if (interaction.commandName === 'bienvenida') {
        const msg = botConfig.welcomeMessage.replace('{user}', interaction.user.username);
        await interaction.reply(`El mensaje es:\n> ${msg}`);
    }
});

client.on('guildMemberAdd', member => {
    const channel = member.guild.channels.cache.find(ch => ch.name === 'general' || ch.name === 'bienvenida');
    if (channel) channel.send(botConfig.welcomeMessage.replace('{user}', member.user.username));
});

// Anti-Crash
process.on('unhandledRejection', (reason) => console.log(' [Anti-Crash]:', reason));
process.on('uncaughtException', (err) => console.log(' [Anti-Crash]:', err));

client.login(BOT_TOKEN);

// --- SERVIDOR WEB ---
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ secret: 'navidad_secreta', resave: false, saveUninitialized: false }));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy({
    clientID: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    callbackURL: CALLBACK_URL,
    scope: ['identify', 'guilds'] // IMPORTANTE: Pide acceso a los servidores
}, (accessToken, refreshToken, profile, done) => process.nextTick(() => done(null, profile))));

app.get('/', (req, res) => res.render('index', { user: req.user }));
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => res.redirect('/dashboard'));
app.get('/logout', (req, res) => { req.logout(() => res.redirect('/')); });
app.get('/invite', (req, res) => res.redirect(`https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&scope=bot%20applications.commands`));

// --- RUTA DASHBOARD (SOLUCIÓN LISTA VACÍA) ---
app.get('/dashboard', (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/');

    // 1. Obtener servidores del usuario (de la sesión)
    const userGuilds = req.user.guilds || [];

    // 2. Filtrar donde es ADMINISTRADOR (Permiso 0x8)
    // Usamos BigInt o parseInt para asegurar que la comparación funcione
    const adminServers = userGuilds.filter(guild => {
        const perms = parseInt(guild.permissions);
        return (perms & 0x8) === 0x8;
    });

    // 3. Stats reales del bot
    const botStats = {
        servers: client.guilds.cache.size || 0,
        users: client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0) || 0,
        ping: Math.round(client.ws.ping) || 0,
        status: 'En Línea'
    };

    res.render('dashboard', { 
        user: req.user, 
        config: botConfig,
        stats: botStats,
        servers: adminServers // Enviamos la lista filtrada y segura
    });
});

app.post('/save-config', (req, res) => {
    if (!req.isAuthenticated()) return res.status(403).send("No autorizado");
    botConfig.prefix = req.body.prefix;
    botConfig.welcomeMessage = req.body.welcomeMessage;
    saveConfig();
    res.sendStatus(200);
});

app.listen(3000, () => {
    console.log('🌐 Dashboard web listo en http://localhost:3000');
});