const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Linux distro data
const distros = require('./data/distros.json');

// Game state storage (in-memory, per server instance)
const gameState = {
    currentTarget: null,
    previousTarget: null,
    wasGuessed: false,
    guessCount: 0,
    missCount: 0,
    revealedHints: [],
    discoveredFields: []
};

// Get all distro names for autocomplete
app.get('/api/distros', (req, res) => {
    res.json(distros.map(d => d.name));
});

// Get random target distro
app.get('/api/target', (req, res) => {
    // If there was a previous target that wasn't guessed, return it as the answer
    const previousAnswer = (!gameState.wasGuessed && gameState.previousTarget) ? {
        id: gameState.previousTarget.id,
        name: gameState.previousTarget.name,
        details: gameState.previousTarget
    } : null;
    
    // Select new random target
    const randomDistro = distros[Math.floor(Math.random() * distros.length)];
    
    // Update game state
    gameState.previousTarget = gameState.currentTarget;
    gameState.currentTarget = randomDistro;
    gameState.wasGuessed = false;
    gameState.guessCount = 0;
    gameState.missCount = 0;
    gameState.revealedHints = [];
    gameState.discoveredFields = [];
    
    res.json({
        id: randomDistro.id,
        name: randomDistro.name,
        previousAnswer: previousAnswer
    });
});

// Check guess against target
app.post('/api/guess', (req, res) => {
    const { guessName, targetId } = req.body;
    
    let guessNameProcessed = guessName.trim();
    
    // Fuzzy matching: if no exact match, find the closest match
    let guess = distros.find(d => d.name.toLowerCase() === guessNameProcessed.toLowerCase());
    
    if (!guess && guessNameProcessed.length > 0) {
        // Find first distro that starts with the input (case-insensitive)
        guess = distros.find(d => d.name.toLowerCase().startsWith(guessNameProcessed.toLowerCase()));
        
        // If no starts-with match, find any distro that contains the input
        if (!guess) {
            guess = distros.find(d => d.name.toLowerCase().includes(guessNameProcessed.toLowerCase()));
        }
    }
    
    const target = distros.find(d => String(d.id) === String(targetId));
    
    if (!guess || !target) {
        return res.status(404).json({ error: 'Distribution not found' });
    }
    
    // Compare attributes and generate feedback
    const feedback = compareDistros(guess, target);

    // Persist what the player has already learned this round.
    const hintFields = ['paid', 'initSystem', 'releaseType', 'parentDistro', 'packageManager', 'difficulty', 'yearReleased', 'desktopEnvironment', 'basedOn', 'architecture', 'category'];
    const newlyDiscovered = hintFields.filter(f => feedback[f] && feedback[f].status === 'correct');
    gameState.discoveredFields = [...new Set([...gameState.discoveredFields, ...newlyDiscovered])];
    
    // Update game state if correct
    const isCorrect = guess.id === target.id;
    if (isCorrect) {
        gameState.wasGuessed = true;
    } else {
        gameState.missCount++;
    }
    gameState.guessCount++;
    
    // Generate hint if at 5, 10, 15... misses
    const hintLevels = [5, 10, 15, 20, 25];
    const currentMisses = gameState.missCount;
    const targetMisses = hintLevels.find(m => currentMisses === m);
    
    let newHint = null;
    if (targetMisses) {
        newHint = generateNewHint(target);
    }
    
    res.json({
        guess: guess,
        matchedName: guess.name,
        feedback: feedback,
        isCorrect: isCorrect,
        guessCount: gameState.guessCount,
        missCount: gameState.missCount,
        newHint: newHint,
        revealedHints: gameState.revealedHints
    });
});

function generateNewHint(target) {
    const hintFields = ['paid', 'initSystem', 'releaseType', 'parentDistro', 'packageManager', 'difficulty', 'yearReleased', 'desktopEnvironment', 'basedOn', 'architecture', 'category'];

    const availableHints = hintFields.filter(f => !gameState.discoveredFields.includes(f) && !gameState.revealedHints.includes(f));
    
    if (availableHints.length === 0) return null;
    
    const field = availableHints[Math.floor(Math.random() * availableHints.length)];
    gameState.revealedHints.push(field);
    
    let value = target[field];
    let displayField = field;
    
    if (field === 'popularity') {
        const levels = ['Very Low', 'Low', 'Medium', 'High', 'Very High'];
        const idx = levels.indexOf(value);
        value = idx <= 1 ? 'Popularity is Low or Very Low' : (idx >= 3 ? 'Popularity is High or Very High' : 'Popularity is Medium');
    }
    
    return {
        field: displayField,
        value: value,
        displayField: displayField.charAt(0).toUpperCase() + displayField.slice(1).replace(/([A-Z])/g, ' $1').trim()
    };
}

function compareDistros(guess, target) {
    return {
        name: {
            value: guess.name,
            status: guess.id === target.id ? 'correct' : 'incorrect'
        },
        paid: {
            value: guess.paid ? 'Yes' : 'No',
            status: getStatus(guess.paid, target.paid)
        },
        initSystem: {
            value: guess.initSystem,
            status: getStatus(guess.initSystem, target.initSystem)
        },
        releaseType: {
            value: guess.releaseType,
            status: getStatus(guess.releaseType, target.releaseType)
        },
        parentDistro: {
            value: guess.parentDistro,
            status: getStatus(guess.parentDistro, target.parentDistro)
        },
        packageManager: {
            value: guess.packageManager,
            status: getStatus(guess.packageManager, target.packageManager)
        },
        difficulty: {
            value: guess.difficulty,
            status: getDifficultyStatus(guess.difficulty, target.difficulty)
        },
        yearReleased: {
            value: guess.yearReleased,
            status: getYearStatus(guess.yearReleased, target.yearReleased),
            direction: getYearDirection(guess.yearReleased, target.yearReleased)
        },
        desktopEnvironment: {
            value: guess.desktopEnvironment,
            status: getStatus(guess.desktopEnvironment, target.desktopEnvironment)
        },
        basedOn: {
            value: guess.basedOn,
            status: getBasedOnStatus(guess.basedOn, target.basedOn)
        },
        architecture: {
            value: guess.architecture,
            status: getStatus(guess.architecture, target.architecture)
        },
        category: {
            value: guess.category,
            status: getStatus(guess.category, target.category)
        }
    };
}

function getStatus(guess, target) {
    if (guess === target) return 'correct';
    return 'incorrect';
}

function getParentStatus(guess, target) {
    if (guess === target) return 'correct';
    if (target.parentDistro === 'Independent' || guess === target.baseFor) return 'partial';
    return 'incorrect';
}

function getDifficultyStatus(guess, target) {
    const levels = ['Beginner', 'Intermediate', 'Advanced', 'Expert'];
    const guessIndex = levels.indexOf(guess);
    const targetIndex = levels.indexOf(target);
    
    if (guess === target) return 'correct';
    if (Math.abs(guessIndex - targetIndex) === 1) return 'partial';
    return 'incorrect';
}

function getYearStatus(guess, target) {
    if (guess === target) return 'correct';
    if (Math.abs(guess - target) <= 2) return 'partial';
    return 'incorrect';
}

function getYearDirection(guess, target) {
    if (guess === target) return null;
    if (guess < target) return 'up'; // Target is newer (higher year)
    return 'down'; // Target is older (lower year)
}

function getBasedOnStatus(guess, target) {
    if (guess === target) return 'correct';
    // Check if they share the same base
    if (guess === target || (guess && target && guess.toLowerCase() === target.toLowerCase())) {
        return 'correct';
    }
    // Partial if one is based on the other
    if (guess && target && (guess.includes(target) || target.includes(guess))) {
        return 'partial';
    }
    return 'incorrect';
}

function getPopularityStatus(guess, target) {
    const levels = ['Very Low', 'Low', 'Medium', 'High', 'Very High'];
    const guessIndex = levels.indexOf(guess);
    const targetIndex = levels.indexOf(target);
    
    if (guess === target) return 'correct';
    if (Math.abs(guessIndex - targetIndex) === 1) return 'partial';
    return 'incorrect';
}

function getPopularityDirection(guess, target) {
    const levels = ['Very Low', 'Low', 'Medium', 'High', 'Very High'];
    const guessIndex = levels.indexOf(guess);
    const targetIndex = levels.indexOf(target);
    
    if (guess === target) return null;
    if (guessIndex < targetIndex) return 'up'; // Target is more popular
    return 'down'; // Target is less popular
}

app.listen(PORT, () => {
    console.log(`Distrodle server running on http://localhost:${PORT}`);
});
