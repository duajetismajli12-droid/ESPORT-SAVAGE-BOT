const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'esports_db.json');

function readDB() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            const initialData = { tournament: null, teams: {}, stats: {}, matches: [] };
            fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 4));
            return initialData;
        }
        return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (err) {
        console.error("❌ Gabim gjatë leximit të databazës:", err);
        return { tournament: null, teams: {}, stats: {}, matches: [] };
    }
}

function writeDB(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 4));
    } catch (err) {
        console.error("❌ Gabim gjatë shkrimit në databazë:", err);
    }
}

module.exports = {
    getTournament() { return readDB().tournament; },
    saveTournament(tourData) {
        const db = readDB();
        db.tournament = tourData;
        writeDB(db);
    },
    
    getTeams() { return readDB().teams; },
    saveTeam(teamId, teamData) {
        const db = readDB();
        db.teams[teamId] = teamData;
        writeDB(db);
    },
    deleteTeam(teamId) {
        const db = readDB();
        delete db.teams[teamId];
        writeDB(db);
    },

    getStats() { return readDB().stats; },
    savePlayerStats(userId, statsData) {
        const db = readDB();
        db.stats[userId] = statsData;
        writeDB(db);
    },

    getMatches() { return readDB().matches; },
    saveMatches(matchesArray) {
        const db = readDB();
        db.matches = matchesArray;
        writeDB(db);
    },
    
    findTeamByPlayerName(name) {
        const db = readDB();
        return Object.values(db.teams).find(t => t.name.toLowerCase() === name.toLowerCase());
    }
};