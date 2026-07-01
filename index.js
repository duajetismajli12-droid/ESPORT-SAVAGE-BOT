require('dotenv').config();
const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, 
    TextInputStyle, PermissionFlagsBits 
} = require('discord.js');
const Tesseract = require('tesseract.js');
const db = require('./database.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

const COLOR_PRIMARY = '#1A1A2E';
const COLOR_GOLD = '#FFD700';
const COLOR_PURPLE = '#6A0D91';
const COLOR_SUCCESS = '#00FF66';
const COLOR_DANGER = '#FF0055';
const COLOR_CYAN = '#00FFFF';

// Variabël në kujtesë për të mbajtur të dhënat e Live Panelit aktual
let currentLivePanel = {
    messageId: null,
    channelId: null,
    team1: "Team 1",
    team2: "Team 2",
    map: "Zone 9",
    score: "0 - 0"
};

client.once('ready', () => {
    console.log(`🏆 [DANGER ESPORTS] Sistemi u ndez! U shtua Live Panel dhe roli i Kapitenit.`);
});

async function updateRegisterEmbed(guild) {
    const tour = db.getTournament();
    if (!tour || !tour.msgId || !tour.channelId) return;
    try {
        const channel = await guild.channels.fetch(tour.channelId).catch(() => null);
        if (!channel) return;
        const message = await channel.messages.fetch(tour.msgId).catch(() => null);
        if (!message) return;

        const updatedEmbed = new EmbedBuilder()
            .setTitle('📝 REGJISTRIMI I EKIPEVE')
            .setDescription(`Turneu: **${tour.name}**\nSasia: \`${tour.registeredCount}/${tour.maxTeams}\` ekipe.\n\nKliko **Register Team** për t'u regjistruar, ose **Anulo Regjistrimin** nëse dëshiron të tërhiqesh.`)
            .setColor(COLOR_PURPLE);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_open_reg_modal').setLabel('Register Team').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('btn_cancel_registration').setLabel('Anulo Regjistrimin').setStyle(ButtonStyle.Danger)
        );
        await message.edit({ embeds: [updatedEmbed], components: [row] });
    } catch (error) {
        console.error('Gabim gjatë përditësimit live:', error);
    }
}

// Funksion ndihmës për të përditësuar Live Panel-in ekzistues
async function refreshLivePanel(guild) {
    if (!currentLivePanel.messageId || !currentLivePanel.channelId) return false;
    try {
        const channel = await guild.channels.fetch(currentLivePanel.channelId).catch(() => null);
        if (!channel) return false;
        const message = await channel.messages.fetch(currentLivePanel.messageId).catch(() => null);
        if (!message) return false;

        const updatedPanelEmbed = new EmbedBuilder()
            .setTitle('🟣 LIVE MATCH')
            .setColor(COLOR_PURPLE)
            .setDescription(
                `🏆 **Team 1:** ${currentLivePanel.team1}\n` +
                `🔵 **Team 2:** ${currentLivePanel.team2}\n\n` +
                `🗺️ **Map:** ${currentLivePanel.map}\n` +
                `📊 **Score:** \`${currentLivePanel.score}\`\n\n` +
                `🔥 **Status:** \`LIVE\``
            )
            .setTimestamp();

        await message.edit({ embeds: [updatedPanelEmbed] });
        return true;
    } catch (error) {
        console.error('Gabim gjatë përditësimit të Live Panel:', error);
        return false;
    }
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const isStaff = message.member?.permissions.has(PermissionFlagsBits.Administrator) || (process.env.ROLE_STAFF && message.member?.roles.cache.has(process.env.ROLE_STAFF));

    // ==========================================
    // 📸 SKANERI AUTOMATIK I SCREENSHOTS (OCR)
    // ==========================================
    if (process.env.SCREENSHOT_CHANNEL_ID && message.channel.id === process.env.SCREENSHOT_CHANNEL_ID) {
        if (!isStaff) return;

        const attachment = message.attachments.first();
        if (!attachment || !attachment.contentType?.startsWith('image/')) return;

        const statusMsg = await message.reply('⏳ **Mora foton! Duke e skanuar me inteligjencë artificiale (OCR)...**');

        try {
            const { data: { text } } = await Tesseract.recognize(attachment.url, 'eng');
            const scannedText = text.toLowerCase();

            let matches = db.getMatches();
            let activeMatch = matches.find(m => m.status === 'LIVE');

            if (!activeMatch) {
                return statusMsg.edit('⚠️ Fotoja erdhi, por nuk ka asnjë ndeshje status `LIVE` në sistem aktualisht. Aktivizoje me `!match live`.');
            }

            const team1Found = scannedText.includes(activeMatch.team1.toLowerCase());
            const team2Found = scannedText.includes(activeMatch.team2.toLowerCase());

            let winnerName = null;

            if (team1Found && !team2Found) {
                winnerName = activeMatch.team1;
            } else if (team2Found && !team1Found) {
                winnerName = activeMatch.team2;
            } else if (team1Found && team2Found) {
                if (scannedText.indexOf(activeMatch.team1.toLowerCase()) < scannedText.indexOf(activeMatch.team2.toLowerCase())) {
                    winnerName = activeMatch.team1;
                } else {
                    winnerName = activeMatch.team2;
                }
            }

            if (!winnerName) {
                return statusMsg.edit(`⚠️ Skaneri nuk arriti të dallonte emrin e **${activeMatch.team1}** ose **${activeMatch.team2}** në foto.\nJu lutem mbylleni manualisht me komandën: \`!match end ${activeMatch.team1} vs ${activeMatch.team2} 2-1 [Fituesi]\``);
            }

            activeMatch.winner = winnerName;
            activeMatch.score = "Skanuar (Auto)";
            activeMatch.status = 'FINISHED';
            db.saveMatches(matches);

            const teams = db.getTeams();
            Object.values(teams).forEach(t => {
                if (t.name.toLowerCase() === activeMatch.team1.toLowerCase() || t.name.toLowerCase() === activeMatch.team2.toLowerCase()) {
                    t.players.forEach(pId => {
                        let pStats = db.getStats()[pId] || { userId: pId, wins: 0, losses: 0, kills: 0, deaths: 0, kd: 0, mvp: 0 };
                        if (t.name.toLowerCase() === winnerName.toLowerCase()) pStats.wins += 1;
                        else pStats.losses += 1;
                        db.savePlayerStats(pId, pStats);
                    });
                }
            });

            return statusMsg.edit(`✅ **Skanimi doli me sukses!**\n🏆 Ndeshja #${activeMatch.id} u mbyll automatikisht.\nFituesi i dalluar në foto: **${winnerName}**`);

        } catch (err) {
            console.error(err);
            return statusMsg.edit('❌ Ndodhi një gabim gjatë leximit të fotos. Provoni përsëri ose mbylleni manualisht.');
        }
    }

    if (!message.content.startsWith('!')) return;

    let rawContent = message.content.slice(1).trim();
    if (rawContent.startsWith('matcesh')) {
        rawContent = rawContent.replace('matcesh', 'matches');
    }

    const args = rawContent.split(/ +/);
    const command = args.shift().toLowerCase();

    // ==========================================
    // 🕹️ MENAXHIMI I NDESHJES LIVE (LIVE PANEL)
    // ==========================================
    if (command === 'match') {
        const subCommand = args.shift()?.toLowerCase();

        // 1. !match livepanel Team1 vs Team2
        if (subCommand === 'livepanel') {
            if (!isStaff) return message.reply('❌ Nuk keni autorizim.');
            
            const fullText = args.join(' ').trim();
            const parts = fullText.split(/\bvs\b/i);

            if (parts.length !== 2) {
                return message.reply('⚠️ Përdorimi: `!match livepanel [Ekipi 1] vs [Ekipi 2]`');
            }

            currentLivePanel.team1 = parts[0].trim();
            currentLivePanel.team2 = parts[1].trim();
            currentLivePanel.map = "Zone 9"; 
            currentLivePanel.score = "0 - 0"; 
            currentLivePanel.channelId = message.channel.id;

            const initialEmbed = new EmbedBuilder()
                .setTitle('🟣 LIVE MATCH')
                .setColor(COLOR_PURPLE)
                .setDescription(
                    `🏆 **Team 1:** ${currentLivePanel.team1}\n` +
                    `🔵 **Team 2:** ${currentLivePanel.team2}\n\n` +
                    `🗺️ **Map:** ${currentLivePanel.map}\n` +
                    `📊 **Score:** \`${currentLivePanel.score}\`\n\n` +
                    `🔥 **Status:** \`LIVE\``
                )
                .setTimestamp();

            const sentMessage = await message.channel.send({ embeds: [initialEmbed] });
            currentLivePanel.messageId = sentMessage.id; 

            return await message.delete().catch(() => null);
        }

        // 2. !match score 5-3
        if (subCommand === 'score') {
            if (!isStaff) return message.reply('❌ Nuk keni autorizim.');
            
            const newScore = args.join(' ').trim();
            if (!newScore) return message.reply('⚠️ Përdorimi: `!match score [Rezultati]` (p.sh: `5-3`)');

            if (!currentLivePanel.messageId) {
                return message.reply('❌ Nuk ka asnjë Live Panel aktiv momentalisht. Krijoni një me `!match livepanel`.');
            }

            currentLivePanel.score = newScore;
            const success = await refreshLivePanel(message.guild);

            if (success) {
                return await message.delete().catch(() => null);
            } else {
                return message.reply('❌ Nuk u arrit të përditësohej paneli. Sigurohuni që mesazhi ekziston ende.');
            }
        }

        // 3. !match map Rust
        if (subCommand === 'map') {
            if (!isStaff) return message.reply('❌ Nuk keni autorizim.');
            
            const newMap = args.join(' ').trim();
            if (!newMap) return message.reply('⚠️ Përdorimi: `!match map [Emri i Map-it]` (p.sh: `Rust`)');

            if (!currentLivePanel.messageId) {
                return message.reply('❌ Nuk ka asnjë Live Panel aktiv momentalisht. Krijoni një me `!match livepanel`.');
            }

            currentLivePanel.map = newMap;
            const success = await refreshLivePanel(message.guild);

            if (success) {
                return await message.delete().catch(() => null);
            } else {
                return message.reply('❌ Nuk u arrit të përditësohej paneli. Sigurohuni që mesazhi ekziston ende.');
            }
        }
    }

    // ==========================================
    // 🏆 KOMANDA: !teaminfo <emri/kapiteni/bosh>
    // ==========================================
    if (command === 'teaminfo') {
        const query = args.join(' ').trim();
        const teams = db.getTeams() || {};
        const teamList = Object.values(teams);

        if (!query) {
            if (teamList.length === 0) {
                return message.reply('ℹ️ Nuk ka asnjë ekip të regjistruar aktualisht në turne.');
            }

            const listEmbed = new EmbedBuilder()
                .setTitle('👥 TEAM INFORMATION')
                .setColor(COLOR_PRIMARY)
                .setTimestamp();

            let descriptionText = "📋 **Ekipet e regjistruara**\n";
            teamList.forEach((t, index) => {
                descriptionText += `\n${index + 1}️⃣ **${t.name}**\n👑 Captain: <@${t.captainId}>\n`;
            });

            descriptionText += `\n━━━━━━━━━━━━━━━━━━\n📊 **Total Teams: ${teamList.length}**`;
            listEmbed.setDescription(descriptionText);
            
            return message.channel.send({ embeds: [listEmbed] });
        }

        let foundTeam = null;
        const mentionedUser = message.mentions.users.first();

        if (mentionedUser) {
            foundTeam = teamList.find(t => t.captainId === mentionedUser.id);
        } else {
            foundTeam = teamList.find(t => t.name.toLowerCase() === query.toLowerCase() || t.teamId.toLowerCase() === query.toLowerCase());
        }

        if (!foundTeam) {
            return message.reply('❌ Nuk u gjet asnjë ekip me këtë emër ose me këtë kapiten.');
        }

        const matches = db.getMatches() || [];
        let wins = 0;
        let losses = 0;

        matches.forEach(m => {
            if (m.status === 'FINISHED') {
                if (m.winner && m.winner.toLowerCase() === foundTeam.name.toLowerCase()) {
                    wins++;
                } else if (m.team1.toLowerCase() === foundTeam.name.toLowerCase() || m.team2.toLowerCase() === foundTeam.name.toLowerCase()) {
                    losses++;
                }
            }
        });

        const totalMatches = wins + losses;
        const winRate = totalMatches > 0 ? Math.round((wins / totalMatches) * 100) : 0;

        let allTeamsWins = {};
        teamList.forEach(t => { allTeamsWins[t.name] = 0; });
        matches.forEach(m => {
            if (m.status === 'FINISHED' && m.winner) {
                const exTeam = teamList.find(t => t.name.toLowerCase() === m.winner.toLowerCase());
                const fName = exTeam ? exTeam.name : m.winner;
                allTeamsWins[fName] = (allTeamsWins[fName] || 0) + 1;
            }
        });

        const sortedTeams = Object.entries(allTeamsWins).sort((a, b) => b[1] - a[1]);
        const rankIndex = sortedTeams.findIndex(([tName]) => tName.toLowerCase() === foundTeam.name.toLowerCase());
        const rankDisplay = rankIndex !== -1 ? `#${rankIndex + 1}` : "#-";

        const mainPlayers = foundTeam.players.slice(0, 4);
        const subPlayers = foundTeam.players.slice(4);

        let playersListText = mainPlayers.map(pId => `• <@${pId}>`).join('\n') || '• Nuk ka lojtarë';
        let subListText = subPlayers.map(pId => `• <@${pId}>`).join('\n') || '• Nuk ka rezervë';

        const statusDisplay = foundTeam.verified ? 'Verified ✅' : 'Pending ⏳';
        const regDate = foundTeam.registeredAt || new Date().toLocaleDateString('sq-AL');

        const teamEmbed = new EmbedBuilder()
            .setTitle('🏆 TEAM INFORMATION')
            .setColor(COLOR_GOLD)
            .setDescription(
                `📛 **Emri:** ${foundTeam.name}\n` +
                `🆔 **Team ID:** \`${foundTeam.teamId}\`\n\n` +
                `👑 **Kapiteni:** <@${foundTeam.captainId}>\n` +
                `🎮 **Emri në lojë:** \`${foundTeam.captainInGame || 'Pa emër'}\`\n\n` +
                `👥 **Lojtarët:**\n${playersListText}\n\n` +
                `🪑 **Sub:**\n${subListText}\n\n` +
                `✅ **Statusi:** \`${statusDisplay}\`\n\n` +
                `📊 **Statistikat:**\n` +
                `🏆 Fitore: \`${wins}\`\n` +
                `❌ Humbje: \`${losses}\`\n` +
                `🎮 Ndeshje: \`${totalMatches}\`\n` +
                `📈 Win Rate: \`${winRate}%\`\n\n` +
                `🥇 **Renditja:** \`${rankDisplay}\`\n\n` +
                `📅 **Regjistruar më:**\n\`${regDate}\``
            )
            .setTimestamp();

        return message.channel.send({ embeds: [teamEmbed] });
    }

    // ==========================================
    // 👤 KOMANDA: !stats [@user]
    // ==========================================
    if (command === 'stats') {
        const targetUser = message.mentions.users.first() || message.author;
        const stats = db.getStats() || {};
        const playerStats = stats[targetUser.id] || { userId: targetUser.id, wins: 0, losses: 0, kills: 0, deaths: 0, kd: 0 };

        const teams = db.getTeams() || {};
        const userTeam = Object.values(teams).find(t => t.players.includes(targetUser.id));
        const teamName = userTeam ? userTeam.name : "Pa Ekip";

        const totalMatches = playerStats.wins + playerStats.losses;
        const winRate = totalMatches > 0 ? Math.round((playerStats.wins / totalMatches) * 100) : 0;
        const kdRatio = playerStats.kd || 0;

        const allPlayersSorted = Object.values(stats).sort((a, b) => (b.kd || 0) - (a.kd || 0));
        const rankIndex = allPlayersSorted.findIndex(p => p.userId === targetUser.id);
        const rankDisplay = rankIndex !== -1 ? `#${rankIndex + 1}` : "I parankuar";

        const statsEmbed = new EmbedBuilder()
            .setTitle('🎮 PLAYER STATS')
            .setColor(COLOR_SUCCESS)
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .setDescription(
                `👤 **Lojtari:** <@${targetUser.id}>\n` +
                `👑 **Ekipi:** \`${teamName}\`\n\n` +
                `🏆 **Fitore:** \`${playerStats.wins}\`\n` +
                `❌ **Humbje:** \`${playerStats.losses}\`\n` +
                `🎯 **Kills:** \`${playerStats.kills || 0}\`\n` +
                `💀 **Deaths:** \`${playerStats.deaths || 0}\`\n` +
                `📊 **K/D Ratio:** \`${kdRatio.toFixed(2)}\`\n` +
                `🎮 **Ndeshje të Luajtura:** \`${totalMatches}\`\n` +
                `📈 **Win Rate:** \`${winRate}%\`\n\n` +
                `🥇 **Rank:** \`${rankDisplay}\``
            )
            .setTimestamp();

        return message.channel.send({ embeds: [statsEmbed] });
    }

    // ==========================================
    // 📊 KOMANDA: !leaderboard [wins/kd]
    // ==========================================
    if (command === 'leaderboard') {
        const type = args[0]?.toLowerCase();

        if (!type || (type !== 'wins' && type !== 'kd')) {
            return message.reply('⚠️ Përdorimi: `!leaderboard wins` (për ekipet) ose `!leaderboard kd` (për lojtarët)');
        }

        if (type === 'wins') {
            const matches = db.getMatches() || [];
            let teamWins = {};

            const registeredTeams = db.getTeams() || {};
            Object.values(registeredTeams).forEach(t => {
                teamWins[t.name] = 0;
            });

            matches.forEach(m => {
                if (m.status === 'FINISHED' && m.winner) {
                    const exactTeam = Object.values(registeredTeams).find(t => t.name.toLowerCase() === m.winner.toLowerCase());
                    const finalName = exactTeam ? exactTeam.name : m.winner;
                    teamWins[finalName] = (teamWins[finalName] || 0) + 1;
                }
            });

            const sortedTeams = Object.entries(teamWins)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10);

            if (sortedTeams.length === 0) {
                return message.reply('ℹ️ Nuk ka të dhëna për fitoret e ekipeve aktualisht.');
            }

            const winsEmbed = new EmbedBuilder()
                .setTitle('🏆 TOP 10 EKIPET ME MË SHUMË FITORE')
                .setColor(COLOR_GOLD)
                .setTimestamp();

            let descriptionText = "";
            const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

            sortedTeams.forEach(([teamName, wins], index) => {
                descriptionText += `${medals[index]} **${teamName}** — \`${wins} Fitore\`\n`;
            });

            winsEmbed.setDescription(descriptionText);
            return message.channel.send({ embeds: [winsEmbed] });
        }

        if (type === 'kd') {
            const stats = db.getStats() || {};
            const allPlayers = Object.values(stats);

            const sortedPlayers = allPlayers
                .sort((a, b) => (b.kd || 0) - (a.kd || 0))
                .slice(0, 10);

            if (sortedPlayers.length === 0) {
                return message.reply('ℹ️ Nuk ka të dhëna statistikore për K/D e lojtarëve.');
            }

            const kdEmbed = new EmbedBuilder()
                .setTitle('🎯 TOP 10 LOJTARËT ME K/D MË TË LARTË')
                .setColor(COLOR_CYAN)
                .setTimestamp();

            let descriptionText = "";
            const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

            sortedPlayers.forEach((player, index) => {
                const playerKd = player.kd ? player.kd.toFixed(2) : "0.00";
                descriptionText += `${medals[index]} <@${player.userId}> — K/D: \`${playerKd}\` *(Kills: ${player.kills || 0} / Deaths: ${player.deaths || 0})*\n`;
            });

            kdEmbed.setDescription(descriptionText);
            return message.channel.send({ embeds: [kdEmbed] });
        }
    }

    if (command === 'tourreset') {
        if (!isStaff) return message.reply('❌ Nuk keni autorizim.');
        db.saveMatches([]);
        db.saveTournament(null);
        
        const resetEmbed = new EmbedBuilder()
            .setTitle('🔄 REZULTATI: RESET TOTAL')
            .setDescription('Sistemi i turneut u fshi me sukses!\nTë gjitha ndeshjet, skedulat dhe skuadrat e regjistruara u fshinë.')
            .setColor(COLOR_DANGER);
        return message.channel.send({ embeds: [resetEmbed] });
    }

    if (command === 'matches' && args[0] === 'add') {
        if (!isStaff) return message.reply('❌ Nuk keni autorizim.');
        const fullText = args.slice(1).join(' ');
        const parts = fullText.split(/\bvs\b/i);

        if (parts.length !== 2) {
            return message.reply('⚠️ Përdorimi: `!matches add [Ekipi 1] vs [Ekipi 2] [Data] [Ora]`');
        }

        const team1 = parts[0].trim();
        const team2WithTime = parts[1].trim();
        const matchTimeIndex = team2WithTime.search(/\s\d|\ssot|\snë|\snesër/i);
        let team2 = team2WithTime;
        let dateTime = "E pacaktuar";

        if (matchTimeIndex !== -1) {
            team2 = team2WithTime.substring(0, matchTimeIndex).trim();
            dateTime = team2WithTime.substring(matchTimeIndex).trim();
        }

        let matches = db.getMatches();
        const nextId = matches.length > 0 ? Math.max(...matches.map(m => m.id)) + 1 : 1;

        matches.push({ id: nextId, team1, team2, time: dateTime, winner: null, score: null, status: 'SCHEDULED' });
        db.saveMatches(matches);

        return message.reply(`📅 Ndeshja #${nextId} u shtua: **${team1}** vs **${team2}** [\`${dateTime}\`]`);
    }

    if (command === 'match' && args[0] === 'live') {
        if (!isStaff) return message.reply('❌ Nuk keni autorizim.');
        const fullText = args.slice(1).join(' ');
        const parts = fullText.split(/\bvs\b/i);
        if (parts.length !== 2) return message.reply('⚠️ Përdorimi: `!match live [Ekipi 1] vs [Ekipi 2]`');

        let matches = db.getMatches();
        let match = matches.find(m => (m.team1.toLowerCase() === parts[0].trim().toLowerCase() && m.team2.toLowerCase() === parts[1].trim().toLowerCase()) && m.status !== 'FINISHED');

        if (!match) return message.reply('❌ Nuk u gjet ndeshje aktive e planifikuar.');
        match.status = 'LIVE';
        db.saveMatches(matches);
        return message.reply(`🎮 Ndeshja #${match.id} tani është **[DUKE LUAJTUR]**!`);
    }

    if (command === 'matches' && !args[0]) {
        const matches = db.getMatches();
        if (matches.length === 0) return message.reply('ℹ️ Nuk ka ndeshje.');
        const matchEmbed = new EmbedBuilder().setTitle('⚔️ SKEDULI ZYRTAR I NDESHJEVE').setColor(COLOR_CYAN);
        matches.forEach(m => {
            if (m.status === 'FINISHED') matchEmbed.addFields({ name: `🟢 Ndeshja #${m.id} [PËRFUNDUAR]`, value: `**${m.team1}** vs **${m.team2}**\n🏆 Rezultati: **${m.score}** (${m.winner})` });
            else if (m.status === 'LIVE') matchEmbed.addFields({ name: `🚨 Ndeshja #${m.id} [DUKE LUAJTUR]`, value: `🔴 **${m.team1}** vs 🔵 **${m.team2}**` });
            else matchEmbed.addFields({ name: `⏳ Ndeshja #${m.id} [E PLANIFIKUAR]`, value: `**${m.team1}** vs **${m.team2}**\n📅 \`${m.time}\`` });
        });
        return message.channel.send({ embeds: [matchEmbed] });
    }

    if (command === 'mapban') {
        if (!isStaff) return message.reply('❌ Mungon autorizimi.');
        const team1User = message.mentions.users.first();
        const team2User = message.mentions.users.at(1);
        if (!team1User || !team2User) return message.reply('⚠️ Përdorimi: `!mapban @Kapiteni1 @Kapiteni2`');

        const mapEmbed = new EmbedBuilder().setTitle('🗺️ MAP PICK VETO (BO3)')
            .setDescription(`Rregulli:\n1️⃣ <@${team1User.id}> bën **PICK**.\n2️⃣ <@${team2User.id}> bën **PICK**.\n3️⃣ Boti zgjedh të 3-tën **Random**!\n\nRadhën e ka: <@${team1User.id}>`).setColor(COLOR_PRIMARY);

        const maps = ['Zone 9', 'Rust', 'Breeze', 'Province', 'Sandstone', 'Sakura'];
        const row = new ActionRowBuilder();
        maps.forEach(map => { row.addComponents(new ButtonBuilder().setCustomId(`mp_${map}_${team1User.id}_${team2User.id}_${team1User.id}_0`).setLabel(map).setStyle(ButtonStyle.Secondary)); });
        return message.channel.send({ embeds: [mapEmbed], components: [row] });
    }

    if (command === 'tournament' && args[0] === 'create') {
        if (!isStaff) return message.reply('❌ Mungon autorizimi.');
        const maxTeams = parseInt(args[args.length - 1]); const name = args.slice(1, args.length - 1).join(' ');
        db.saveTournament({ name, maxTeams, status: 'OPEN', registeredCount: 0, msgId: null, channelId: null }); db.saveMatches([]);
        return message.channel.send({ embeds: [new EmbedBuilder().setTitle(`🏆 TURNE I RI: ${name.toUpperCase()}`).setDescription(`Kufiri: ${maxTeams} Skuadra`).setColor(COLOR_GOLD)] });
    }

    if (command === 'register') {
        const tour = db.getTournament(); if (!tour) return message.reply('❌ Nuk ka turne.');
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('btn_open_reg_modal').setLabel('Register Team').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('btn_cancel_registration').setLabel('Anulo Regjistrimin').setStyle(ButtonStyle.Danger));
        const sent = await message.channel.send({ embeds: [new EmbedBuilder().setTitle('📝 REGJISTRIMI').setDescription(`Turneu: ${tour.name}`).setColor(COLOR_PURPLE)], components: [row] });
        tour.msgId = sent.id; tour.channelId = message.channel.id; db.saveTournament(tour); await message.delete().catch(() => null);
    }
});

client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isButton() && interaction.customId.startsWith('mp_')) {
            const parts = interaction.customId.split('_');
            const clickedMap = parts[1]; const team1Id = parts[2]; const team2Id = parts[3]; const activeCaptainId = parts[4]; let pickCount = parseInt(parts[5]);

            if (interaction.user.id !== activeCaptainId) return interaction.reply({ content: '❌ Nuk është radha juaj.', ephemeral: true });

            pickCount++;
            const currentRows = interaction.message.components[0];
            const updatedRow = new ActionRowBuilder(); let remainingMaps = [];
            
            currentRows.components.forEach(btn => { if (btn.customId.split('_')[1] !== clickedMap && !btn.disabled) remainingMaps.push(btn.customId.split('_')[1]); });
            const nextCaptain = activeCaptainId === team1Id ? team2Id : team1Id;

            currentRows.components.forEach(btn => {
                const mapName = btn.customId.split('_')[1];
                if (mapName === clickedMap || btn.disabled) {
                    const style = mapName === clickedMap ? ButtonStyle.Primary : btn.style;
                    updatedRow.addComponents(ButtonBuilder.from(btn).setDisabled(true).setStyle(style).setLabel(`${mapName} (PICK)`));
                } else {
                    updatedRow.addComponents(new ButtonBuilder().setCustomId(`mp_${mapName}_${team1Id}_${team2Id}_${nextCaptain}_${pickCount}`).setLabel(mapName).setStyle(ButtonStyle.Secondary));
                }
            });

            const nextEmbed = EmbedBuilder.from(interaction.message.embeds[0]);

            if (pickCount === 2) {
                const deciderMap = remainingMaps[Math.floor(Math.random() * remainingMaps.length)];
                nextEmbed.setDescription(`🏁 **VETO PËRFUNDOI!**\n\n🤖 Map 3 (Decider): 🏆 🔥 **${deciderMap.toUpperCase()}** 🔥 🏆`);
                const finalRow = new ActionRowBuilder();
                currentRows.components.forEach(btn => {
                    const mapName = btn.customId.split('_')[1];
                    if (mapName === deciderMap) finalRow.addComponents(ButtonBuilder.from(btn).setDisabled(true).setStyle(ButtonStyle.Success).setLabel(`${mapName} (DECIDER)`));
                    else if (btn.disabled || mapName === clickedMap) finalRow.addComponents(ButtonBuilder.from(btn).setDisabled(true).setStyle(ButtonStyle.Primary).setLabel(`${mapName} (PICK)`));
                    else finalRow.addComponents(ButtonBuilder.from(btn).setDisabled(true).setStyle(ButtonStyle.Danger));
                });
                return await interaction.update({ embeds: [nextEmbed], components: [finalRow] });
            } else {
                nextEmbed.setDescription(`Skuadra zgjodhi **${clickedMap}**.\nRadhën e ka: <@${team2Id}>`);
                return await interaction.update({ embeds: [nextEmbed], components: [updatedRow] });
            }
        }

        if (interaction.isButton() && interaction.customId === 'btn_open_reg_modal') {
            const teams = db.getTeams();
            const alreadyRegistered = Object.values(teams).some(t => t.captainId === interaction.user.id || t.players.includes(interaction.user.id));
            if (alreadyRegistered) return interaction.reply({ content: '❌ Ti je i regjistruar tashmë me një ekip tjetër.', ephemeral: true });

            const modal = new ModalBuilder().setCustomId('modal_esports_reg').setTitle('Esports Team Registration');
            
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('m_name').setLabel('EMRI I EKIPES:').setStyle(TextInputStyle.Short).setRequired(true)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('m_cname').setLabel('LOJTARI 1 (Emri në lojë):').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Shkruaj emrin tuaj në lojë')
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('m_p23').setLabel('LOJTARI 2 dhe 3 (@Tag + Emri në lojë):').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('@Lojtari2 (Emri) / @Lojtari3 (Emri)')
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('m_p4').setLabel('LOJTARI 4 (@Tag + Emri në lojë):').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('@Lojtari4 (Emri i tij)')
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('m_sub').setLabel('SUB (Rezervat - @Tag + Emri):').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('@LojtariSub (Emri i tij)')
                )
            );
            return await interaction.showModal(modal);
        }

        if (interaction.isButton() && interaction.customId === 'btn_cancel_registration') {
            const teams = db.getTeams(); const userTeam = Object.values(teams).find(t => t.captainId === interaction.user.id);
            if (!userTeam) return interaction.reply({ content: '❌ Nuk je kapiten.', ephemeral: true });
            db.deleteTeam(userTeam.teamId); const tour = db.getTournament(); if (tour) { tour.registeredCount = Math.max(0, tour.registeredCount - 1); db.saveTournament(tour); }
            await interaction.reply({ content: `✅ Regjistrimi u anulua.`, ephemeral: true }); return await updateRegisterEmbed(interaction.guild);
        }

        if (interaction.isModalSubmit() && interaction.customId === 'modal_esports_reg') {
            const teamName = interaction.fields.getTextInputValue('m_name');
            const captainInGameName = interaction.fields.getTextInputValue('m_cname');
            const p23Raw = interaction.fields.getTextInputValue('m_p23');
            const p4Raw = interaction.fields.getTextInputValue('m_p4');
            const subRaw = interaction.fields.getTextInputValue('m_sub') || "";
            const tour = db.getTournament();

            if (tour.registeredCount >= tour.maxTeams) return interaction.reply({ content: '❌ Turneu është plot!', ephemeral: true });

            const registeredRoleId = process.env.ROLE_REGISTERED;
            const captainRoleId = process.env.ROLE_CAPTAIN; 

            const registeredRole = registeredRoleId ? interaction.guild.roles.cache.get(registeredRoleId) : null;
            const captainRole = captainRoleId ? interaction.guild.roles.cache.get(captainRoleId) : null;
            
            if (!registeredRole) console.log("⚠️ Kujdes: ROLE_REGISTERED te skedari .env mungon!");
            if (!captainRole) console.log("ℹ️ Info: ROLE_CAPTAIN te skedari .env mungon ose nuk është caktuar.");

            let detectedPlayerIds = [interaction.user.id];
            const rawInputs = [p23Raw, p4Raw, subRaw];

            // Dhënia e roleve KAPITENIT
            if (registeredRole) {
                await interaction.member.roles.add(registeredRole).catch(err => console.log(`Gabim te roli i turneut për kapitenin: ${err.message}`));
            }
            if (captainRole) {
                await interaction.member.roles.add(captainRole).catch(err => console.log(`Gabim te roli Captain për kapitenin: ${err.message}`));
            }

            // Dhënia e roleve lojtarëve të tjerë të skuadrës
            for (const input of rawInputs) {
                if (!input.trim()) continue;
                const matches = input.match(/\d+/g);
                if (matches) {
                    for (const userId of matches) {
                        if (!detectedPlayerIds.includes(userId)) {
                            detectedPlayerIds.push(userId);

                            if (registeredRole) {
                                const member = await interaction.guild.members.fetch(userId).catch(() => null);
                                if (member) {
                                    await member.roles.add(registeredRole).catch(err => console.log(`Gabim te lojtari ${userId}: ${err.message}`));
                                }
                            }
                        }
                    }
                }
            }

            const teamId = `TEAM-${Date.now().toString().slice(-4)}`;
            const todayStr = new Date().toLocaleDateString('sq-AL');
            
            db.saveTeam(teamId, { 
                teamId, 
                name: teamName, 
                captainId: interaction.user.id,
                captainInGame: captainInGameName,
                players: detectedPlayerIds, 
                verified: true,
                registeredAt: todayStr
            });
            
            tour.registeredCount += 1; 
            db.saveTournament(tour); 
            
            await interaction.reply({ 
                content: `✅ Skuadra **${teamName}** u regjistrua me sukses!\n👑 **Kapiteni (Lojtari 1):** \`${captainInGameName}\` (<@${interaction.user.id}>)\n👥 Lojtarët dhe kapiteni morën rolet automatikisht!`, 
                ephemeral: true 
            }); 
            return await updateRegisterEmbed(interaction.guild);
        }
    } catch (err) { console.error(err); }
});

client.login(process.env.DISCORD_TOKEN);