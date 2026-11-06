export const COLOR_GROUPS = {
  brown: { name: 'Bronze', hex: '#9a5b2e', lightHex: '#c98a52', count: 2, houseCost: 50 },
  lightBlue: { name: 'Sky', hex: '#0ea5e9', lightHex: '#67d3ff', count: 3, houseCost: 50 },
  pink: { name: 'Magenta', hex: '#db2777', lightHex: '#f472b6', count: 3, houseCost: 100 },
  orange: { name: 'Sunset', hex: '#ea580c', lightHex: '#fb923c', count: 3, houseCost: 100 },
  red: { name: 'Crimson', hex: '#dc2626', lightHex: '#f87171', count: 3, houseCost: 150 },
  yellow: { name: 'Gold', hex: '#eab308', lightHex: '#fde047', count: 3, houseCost: 150 },
  green: { name: 'Emerald', hex: '#059669', lightHex: '#34d399', count: 3, houseCost: 200 },
  darkBlue: { name: 'Royal', hex: '#1d4ed8', lightHex: '#60a5fa', count: 2, houseCost: 200 },
  railroad: { name: 'Airport', hex: '#334155', lightHex: '#64748b', count: 4, houseCost: 0 },
  utility: { name: 'Utility', hex: '#0f766e', lightHex: '#2dd4bf', count: 2, houseCost: 0 }
};

// Groups whose colour is light enough that dark text reads better on top of it
export const LIGHT_TEXT_GROUPS = ['yellow'];

export const PLAYER_TOKENS = [
  { id: 'crown', name: 'Royal Crown', color: '#FFD700', accent: '#FFA000' },
  { id: 'racecar', name: 'Apex Racer', color: '#FF2A55', accent: '#FF8A80' },
  { id: 'tophat', name: 'Tycoon Hat', color: '#00E5FF', accent: '#84FFFF' },
  { id: 'battleship', name: 'Dreadnought', color: '#00E676', accent: '#B9F6CA' },
  { id: 'obelisk', name: 'Cyber Obelisk', color: '#AA00FF', accent: '#EA80FC' },
  { id: 'aviator', name: 'Sky Jet', color: '#FF9100', accent: '#FFD180' }
];

export const TURN_TIMER_OPTIONS = [0, 30, 60, 90, 120];

const city = (index, name, shortName, country, landmark, group, price, rent, houseCost, mortgage) => ({
  index, name, shortName, country, landmark, type: 'property', group, price, rent, houseCost, mortgage
});

const airport = (index, name, shortName, country) => ({
  index, name, shortName, country, landmark: '✈️', type: 'railroad', group: 'railroad',
  price: 200, rent: [25, 50, 100, 200], mortgage: 100
});

export const BOARD_SPACES = [
  { index: 0, name: 'GO', shortName: 'GO', type: 'go', description: 'Collect $200 salary as you pass!' },
  city(1, 'Cairo', 'CAIRO', 'Egypt', '🐪', 'brown', 60, [2, 10, 30, 90, 160, 250], 50, 30),
  { index: 2, name: 'Community Chest', shortName: 'COMMUNITY CHEST', type: 'chest', description: 'Draw a Community Chest card.' },
  city(3, 'Mumbai', 'MUMBAI', 'India', '🛕', 'brown', 60, [4, 20, 60, 180, 320, 450], 50, 30),
  { index: 4, name: 'Income Tax', shortName: 'INCOME TAX', type: 'tax', taxAmount: 200, description: 'Pay $200 Income Tax to the Bank.' },
  airport(5, 'Heathrow Airport', 'HEATHROW', 'London'),
  city(6, 'Bangkok', 'BANGKOK', 'Thailand', '🛺', 'lightBlue', 100, [6, 30, 90, 270, 400, 550], 50, 50),
  { index: 7, name: 'Chance', shortName: 'CHANCE', type: 'chance', description: 'Draw a Chance card.' },
  city(8, 'Istanbul', 'ISTANBUL', 'Türkiye', '🕌', 'lightBlue', 100, [6, 30, 90, 270, 400, 550], 50, 50),
  city(9, 'Rio de Janeiro', 'RIO', 'Brazil', '🏖️', 'lightBlue', 120, [8, 40, 100, 300, 450, 600], 50, 60),
  { index: 10, name: 'Jail / Just Visiting', shortName: 'JAIL', type: 'jail', description: 'Just Visiting on the outer track, or locked in Jail inside.' },
  city(11, 'Barcelona', 'BARCELONA', 'Spain', '⛪', 'pink', 140, [10, 50, 150, 450, 625, 750], 100, 70),
  { index: 12, name: 'Electric Company', shortName: 'ELECTRIC CO', type: 'utility', group: 'utility', price: 150, mortgage: 75, landmark: '💡', description: 'If one Utility is owned, rent is 4x dice roll. If both are owned, 10x dice roll.' },
  city(13, 'Rome', 'ROME', 'Italy', '🏛️', 'pink', 140, [10, 50, 150, 450, 625, 750], 100, 70),
  city(14, 'Amsterdam', 'AMSTERDAM', 'Netherlands', '🚲', 'pink', 160, [12, 60, 180, 500, 700, 900], 100, 80),
  airport(15, 'Charles de Gaulle Airport', 'CDG', 'Paris'),
  city(16, 'Berlin', 'BERLIN', 'Germany', '🐻', 'orange', 180, [14, 70, 200, 550, 750, 950], 100, 90),
  { index: 17, name: 'Community Chest', shortName: 'COMMUNITY CHEST', type: 'chest', description: 'Draw a Community Chest card.' },
  city(18, 'Sydney', 'SYDNEY', 'Australia', '🦘', 'orange', 180, [14, 70, 200, 550, 750, 950], 100, 90),
  city(19, 'Toronto', 'TORONTO', 'Canada', '🍁', 'orange', 200, [16, 80, 220, 600, 800, 1000], 100, 100),
  { index: 20, name: 'Free Parking', shortName: 'FREE PARKING', type: 'parking', description: 'A peaceful sanctuary. Rest and relax!' },
  city(21, 'Seoul', 'SEOUL', 'South Korea', '🏯', 'red', 220, [18, 90, 250, 700, 875, 1050], 150, 110),
  { index: 22, name: 'Chance', shortName: 'CHANCE', type: 'chance', description: 'Draw a Chance card.' },
  city(23, 'Hong Kong', 'HONG KONG', 'China', '🌃', 'red', 220, [18, 90, 250, 700, 875, 1050], 150, 110),
  city(24, 'Singapore', 'SINGAPORE', 'Singapore', '🦁', 'red', 240, [20, 100, 300, 750, 925, 1100], 150, 120),
  airport(25, 'Changi Airport', 'CHANGI', 'Singapore'),
  city(26, 'Los Angeles', 'LOS ANGELES', 'USA', '🎬', 'yellow', 260, [22, 110, 330, 800, 975, 1150], 150, 130),
  city(27, 'Shanghai', 'SHANGHAI', 'China', '🏙️', 'yellow', 260, [22, 110, 330, 800, 975, 1150], 150, 130),
  { index: 28, name: 'Water Works', shortName: 'WATER WORKS', type: 'utility', group: 'utility', price: 150, mortgage: 75, landmark: '🚰', description: 'If one Utility is owned, rent is 4x dice roll. If both are owned, 10x dice roll.' },
  city(29, 'Zurich', 'ZURICH', 'Switzerland', '🏔️', 'yellow', 280, [24, 120, 360, 850, 1025, 1200], 150, 140),
  { index: 30, name: 'Go To Jail', shortName: 'GO TO JAIL', type: 'gotojail', description: 'Go directly to Jail. Do not pass GO, do not collect $200.' },
  city(31, 'Tokyo', 'TOKYO', 'Japan', '🗼', 'green', 300, [26, 130, 390, 900, 1100, 1275], 200, 150),
  city(32, 'Paris', 'PARIS', 'France', '🥐', 'green', 300, [26, 130, 390, 900, 1100, 1275], 200, 150),
  { index: 33, name: 'Community Chest', shortName: 'COMMUNITY CHEST', type: 'chest', description: 'Draw a Community Chest card.' },
  city(34, 'London', 'LONDON', 'United Kingdom', '💂', 'green', 320, [28, 150, 450, 1000, 1200, 1400], 200, 160),
  airport(35, 'JFK Airport', 'JFK', 'New York'),
  { index: 36, name: 'Chance', shortName: 'CHANCE', type: 'chance', description: 'Draw a Chance card.' },
  city(37, 'Dubai', 'DUBAI', 'UAE', '🌴', 'darkBlue', 350, [35, 175, 500, 1100, 1300, 1500], 200, 175),
  { index: 38, name: 'Luxury Tax', shortName: 'LUXURY TAX', type: 'tax', taxAmount: 100, description: 'Pay $100 Luxury Tax to the Bank.' },
  city(39, 'New York', 'NEW YORK', 'USA', '🗽', 'darkBlue', 400, [50, 200, 600, 1400, 1700, 2000], 200, 200)
];

export const CHANCE_CARDS = [
  { id: 'c1', title: 'Advance to GO', text: 'Advance to GO (Collect $200).', action: 'move', target: 0 },
  { id: 'c2', title: 'Fly to Singapore', text: 'Advance to Singapore. If you pass GO, collect $200.', action: 'move', target: 24 },
  { id: 'c3', title: 'Weekend in Barcelona', text: 'Advance to Barcelona. If you pass GO, collect $200.', action: 'move', target: 11 },
  { id: 'c4', title: 'Nearest Utility', text: 'Advance to the nearest Utility. If unowned, you may buy it. If owned, pay owner 10x dice roll.', action: 'nearest_utility' },
  { id: 'c5', title: 'Nearest Airport', text: 'Advance to the nearest Airport and pay the owner twice the rent they are otherwise entitled to.', action: 'nearest_railroad' },
  { id: 'c6', title: 'Bank Dividend', text: 'Bank pays you dividend of $50.', action: 'cash', amount: 50 },
  { id: 'c7', title: 'Get Out of Jail Free', text: 'Get Out of Jail Free. This card may be kept until needed.', action: 'jail_card' },
  { id: 'c8', title: 'Go Back 3 Spaces', text: 'Go back 3 spaces.', action: 'move_relative', steps: -3 },
  { id: 'c9', title: 'Go to Jail', text: 'Go directly to Jail, do not pass GO, do not collect $200.', action: 'goto_jail' },
  { id: 'c10', title: 'General Repairs', text: 'Make general repairs on all your property: $25 per house, $100 per hotel.', action: 'repairs', houseRate: 25, hotelRate: 100 },
  { id: 'c11', title: 'Speeding Fine', text: 'Speeding fine $15.', action: 'cash', amount: -15 },
  { id: 'c12', title: 'Flight from Heathrow', text: 'Take a trip to Heathrow Airport. If you pass GO, collect $200.', action: 'move', target: 5 },
  { id: 'c13', title: 'Big Apple Calling', text: 'Advance to New York.', action: 'move', target: 39 },
  { id: 'c14', title: 'Chairman of the Board', text: 'You have been elected Chairman of the Board. Pay each player $50.', action: 'pay_each_player', amount: 50 },
  { id: 'c15', title: 'Building Loan Matures', text: 'Your building loan matures. Collect $150.', action: 'cash', amount: 150 },
  { id: 'c16', title: 'Crossword Competition', text: 'You have won a crossword competition. Collect $100.', action: 'cash', amount: 100 }
];

export const CHEST_CARDS = [
  { id: 'cc1', title: 'Advance to GO', text: 'Advance to GO (Collect $200).', action: 'move', target: 0 },
  { id: 'cc2', title: 'Bank Error in Your Favor', text: 'Bank error in your favor. Collect $200.', action: 'cash', amount: 200 },
  { id: 'cc3', title: 'Doctor\'s Fee', text: 'Doctor\'s fee. Pay $50.', action: 'cash', amount: -50 },
  { id: 'cc4', title: 'Stock Sale', text: 'From sale of stock you get $50.', action: 'cash', amount: 50 },
  { id: 'cc5', title: 'Get Out of Jail Free', text: 'Get Out of Jail Free. This card may be kept until needed.', action: 'jail_card' },
  { id: 'cc6', title: 'Go to Jail', text: 'Go directly to Jail, do not pass GO, do not collect $200.', action: 'goto_jail' },
  { id: 'cc7', title: 'Grand Opera Night', text: 'Grand Opera Night. Collect $50 from every player for opening night seats.', action: 'collect_each_player', amount: 50 },
  { id: 'cc8', title: 'Holiday Fund Matures', text: 'Holiday fund matures. Receive $100.', action: 'cash', amount: 100 },
  { id: 'cc9', title: 'Income Tax Refund', text: 'Income tax refund. Collect $20.', action: 'cash', amount: 20 },
  { id: 'cc10', title: 'It Is Your Birthday', text: 'It is your birthday. Collect $10 from every player.', action: 'collect_each_player', amount: 10 },
  { id: 'cc11', title: 'Life Insurance Matures', text: 'Life insurance matures. Collect $100.', action: 'cash', amount: 100 },
  { id: 'cc12', title: 'Hospital Fees', text: 'Pay hospital fees of $100.', action: 'cash', amount: -100 },
  { id: 'cc13', title: 'School Fees', text: 'Pay school fees of $50.', action: 'cash', amount: -50 },
  { id: 'cc14', title: 'Consultancy Fee', text: 'Receive $25 consultancy fee.', action: 'cash', amount: 25 },
  { id: 'cc15', title: 'Street Repairs', text: 'You are assessed for street repairs: $40 per house, $115 per hotel.', action: 'repairs', houseRate: 40, hotelRate: 115 },
  { id: 'cc16', title: 'Beauty Contest', text: 'You have won second prize in a beauty contest. Collect $10.', action: 'cash', amount: 10 }
];
