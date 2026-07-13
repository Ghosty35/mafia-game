// All game text lives here. English is the base language.
// To add a new language later: copy the "en" block and translate it.

export const translations = {
  en: {
    // General
    app_name: 'Mafia Game',
    loading: 'Loading...',

    // Landing page
    landing_tagline: 'Rise through the ranks. Rule the city.',
    landing_description:
      'Commit crimes, earn cash and build your criminal empire. Do you have what it takes to become the most feared boss in town?',
    landing_sign_in: 'Sign In',
    landing_create_account: 'Create Account',

    // Navigation
    nav_dashboard: 'Dashboard',
    nav_crimes: 'Crimes',
    nav_heists: 'Heists',
    nav_armory: 'Armory',
    nav_shop: 'Shop',
    nav_hospital: 'Hospital',
    nav_family: 'Families',
    nav_leaderboard: 'Leaderboard',
    nav_rankings: 'Rankings',
    nav_soon: 'Soon',

    // Auth — shared
    auth_email: 'Email address',
    auth_password: 'Password',
    auth_confirm_password: 'Confirm password',
    auth_username: 'Gangster name',

    // Username claiming
    username_title: 'Choose your gangster name',
    username_desc:
      'This is the name other players will see. Choose wisely — it cannot be changed (yet).',
    username_rules: '3–16 characters: letters, numbers and _',
    username_claim: 'Claim name',
    error_username_taken: 'That name is already taken.',
    error_username_invalid: 'Invalid name. Use 3–16 letters, numbers or _.',

    // Auth — sign in
    signin_title: 'Sign In',
    signin_button: 'Sign In',
    signin_no_account: "Don't have an account yet?",
    signin_register_link: 'Create one here',

    // Auth — register
    register_title: 'Create Account',
    register_button: 'Create Account',
    register_have_account: 'Already have an account?',
    register_signin_link: 'Sign in here',
    register_check_email:
      'Almost there! Check your email inbox to confirm your account.',

    // Auth — errors
    error_invalid_credentials: 'Wrong email or password.',
    error_user_exists: 'An account with this email already exists.',
    error_password_short: 'Password must be at least 6 characters.',
    error_password_mismatch: 'Passwords do not match.',
    error_generic: 'Something went wrong. Please try again.',

    // Dashboard
    dash_welcome: 'Welcome back, boss',
    dash_sign_out: 'Sign Out',
    dash_cash: 'Cash',
    dash_diamonds: 'Diamonds',
    dash_level: 'Level',
    dash_xp: 'Experience',
    dash_coming_soon: 'More features coming soon...',
    error_load_player:
      'Could not load your player profile. Try refreshing the page.',

    // Crimes
    crimes_title: 'Crimes',
    crime_success_rate: 'Success rate',
    crime_reward: 'Loot',
    crime_cooldown: 'Cooldown',
    crime_commit: 'Commit crime',
    crime_ready_in: 'Ready in',
    crime_unlocks_at: 'Unlocks at level',
    crime_result_success: 'Success! You got away with {cash} (+{xp} XP)',
    crime_result_fail: 'Busted! The cops threw you in jail. No XP gained on failure.',
    crime_level_up: 'LEVEL UP! You are now level {level}!',
    error_on_cooldown: 'Too hot right now — this crime is still on cooldown.',
    error_in_jail: 'You are in jail. Wait until you are released.',
    error_level_too_low: 'Your level is too low for this crime.',

    // Shop
    dash_shop_soon: 'Shop coming soon...',

    // Rankings
    rankings_title: 'Rankings',
    rankings_position: '#',
    rankings_player: 'Player',
    rankings_rank: 'Rank',
    rankings_level: 'Level',
    rankings_rebirths: 'Rebirths',
    rankings_you: 'You',
    rankings_your_position: 'Your position',
    rankings_empty: 'No ranked players yet. Go commit some crimes!',
    rankings_no_username:
      'Pick a gangster name on the dashboard to appear on the leaderboard.',
    error_load_leaderboard:
      'Could not load rankings. Try refreshing the page.',

    // Jail
    jail_banner: 'You are in jail',
    jail_release_in: 'Released in',

    // Ranks (low to high)
    dash_rank: 'Rank',
    dash_next_rank: 'Next rank',
    rank_slum_rat: 'Slum Rat',
    rank_street_punk: 'Street Punk',
    rank_thug: 'Thug',
    rank_thief: 'Thief',
    rank_hustler: 'Hustler',
    rank_gangster: 'Gangster',
    rank_enforcer: 'Enforcer',
    rank_hitman: 'Hitman',
    rank_soldato: 'Soldato',
    rank_capo: 'Capo',
    rank_consigliere: 'Consigliere',
    rank_underboss: 'Underboss',
    rank_boss: 'Boss',
    rank_don: 'Don',
    rank_godfather: 'Godfather',

    // Rebirth (prestige)
    rebirth_title: 'Rebirth',
    rebirth_desc:
      "You've reached Godfather — the top of the food chain. Start over from the streets with a permanent +50% cash & XP bonus and 10% faster cooldowns (max 50%). Stacks with every Rebirth.",
    rebirth_button: 'Rebirth',
    rebirth_confirm_text:
      'Your rank resets to Slum Rat (level 1). Your cash stays. This cannot be undone.',
    rebirth_confirm_button: 'Yes, start over stronger',
    rebirth_cancel: 'Cancel',
    rebirth_done:
      'REBORN! The streets whisper your name. You now earn +{bonus}% cash and XP on everything.',
    vip_badge: 'VIP',
    error_not_godfather: 'Only a Godfather can be reborn.',

    // Crime names + descriptions
    crime_pickpocket: 'Pickpocket',
    crime_pickpocket_desc: 'Easy money from careless tourists.',
    crime_rob_store: 'Rob a Store',
    crime_rob_store_desc: 'Quick cash, but the owner might fight back.',
    crime_steal_car: 'Steal a Car',
    crime_steal_car_desc: 'Hotwire it and race to the chop shop.',
    crime_warehouse_heist: 'Warehouse Heist',
    crime_warehouse_heist_desc: 'Hit a warehouse for big scores.',
    crime_train_murder: 'Train Your MurderSkill',
    crime_train_murder_desc: 'Practice your killing skills. High risk PvP training.',
  },

  nl: {
    // Algemeen
    app_name: 'Mafia Game',
    loading: 'Laden...',

    // Landingspagina
    landing_tagline: 'Klim op in de rangen. Regeer de stad.',
    landing_description:
      'Pleeg misdaden, verdien geld en bouw je criminele imperium. Heb jij wat nodig is om de meest gevreesde baas van de stad te worden?',
    landing_sign_in: 'Inloggen',
    landing_create_account: 'Account Aanmaken',

    // Navigatie
    nav_dashboard: 'Dashboard',
    nav_crimes: 'Crimes',
    nav_heists: 'Heists',
    nav_armory: 'Wapenwinkel',
    nav_shop: 'Shop',
    nav_hospital: 'Ziekenhuis',
    nav_family: 'Families',
    nav_leaderboard: 'Leaderboard',
    nav_rankings: 'Ranglijst',
    nav_soon: 'Binnenkort',

    // Auth — gedeeld
    auth_email: 'E-mailadres',
    auth_password: 'Wachtwoord',
    auth_confirm_password: 'Bevestig wachtwoord',
    auth_username: 'Gangsternaam',

    // Naam claimen
    username_title: 'Kies je gangsternaam',
    username_desc:
      'Dit is de naam die andere spelers zien. Kies verstandig — hij kan (nog) niet veranderd worden.',
    username_rules: '3–16 tekens: letters, cijfers en _',
    username_claim: 'Claim naam',
    error_username_taken: 'Die naam is al bezet.',
    error_username_invalid: 'Ongeldige naam. Gebruik 3–16 letters, cijfers of _.',

    // Auth — inloggen
    signin_title: 'Inloggen',
    signin_button: 'Inloggen',
    signin_no_account: 'Nog geen account?',
    signin_register_link: 'Maak er hier een aan',

    // Auth — registreren
    register_title: 'Account Aanmaken',
    register_button: 'Account Aanmaken',
    register_have_account: 'Heb je al een account?',
    register_signin_link: 'Log hier in',
    register_check_email:
      'Bijna klaar! Check je e-mail inbox om je account te bevestigen.',

    // Auth — foutmeldingen
    error_invalid_credentials: 'Verkeerd e-mailadres of wachtwoord.',
    error_user_exists: 'Er bestaat al een account met dit e-mailadres.',
    error_password_short: 'Wachtwoord moet minimaal 6 tekens zijn.',
    error_password_mismatch: 'Wachtwoorden komen niet overeen.',
    error_generic: 'Er ging iets mis. Probeer het opnieuw.',

    // Dashboard
    dash_welcome: 'Welkom terug, baas',
    dash_sign_out: 'Uitloggen',
    dash_cash: 'Geld',
    dash_diamonds: 'Diamanten',
    dash_level: 'Level',
    dash_xp: 'Ervaring',
    dash_coming_soon: 'Meer features komen binnenkort...',
    error_load_player:
      'Kon je spelersprofiel niet laden. Probeer de pagina te verversen.',

    // Misdaden
    crimes_title: 'Misdaden',
    crime_success_rate: 'Slagingskans',
    crime_reward: 'Buit',
    crime_cooldown: 'Cooldown',
    crime_commit: 'Pleeg misdaad',
    crime_ready_in: 'Klaar over',
    crime_unlocks_at: 'Ontgrendelt op level',
    crime_result_success: 'Gelukt! Je bent ontkomen met {cash} (+{xp} XP)',
    crime_result_fail: 'Gepakt! De politie heeft je in de cel gegooid. Geen XP bij falen.',
    crime_level_up: 'LEVEL OMHOOG! Je bent nu level {level}!',
    error_on_cooldown: 'Te heet op dit moment — deze misdaad is nog in cooldown.',
    error_in_jail: 'Je zit in de cel. Wacht tot je vrijkomt.',
    error_level_too_low: 'Je level is te laag voor deze misdaad.',

    // Shop
    dash_shop_soon: 'Shop komt binnenkort...',

    // Ranglijst
    rankings_title: 'Ranglijst',
    rankings_position: '#',
    rankings_player: 'Speler',
    rankings_rank: 'Rang',
    rankings_level: 'Level',
    rankings_rebirths: 'Rebirths',
    rankings_you: 'Jij',
    rankings_your_position: 'Jouw positie',
    rankings_empty: 'Nog geen spelers in de ranglijst. Pleeg wat misdaden!',
    rankings_no_username:
      'Kies een gangsternaam op het dashboard om in de ranglijst te verschijnen.',
    error_load_leaderboard:
      'Kon de ranglijst niet laden. Probeer de pagina te verversen.',

    // Cel
    jail_banner: 'Je zit in de cel',
    jail_release_in: 'Vrij over',

    // Rangen (laag naar hoog)
    dash_rank: 'Rang',
    dash_next_rank: 'Volgende rang',
    rank_slum_rat: 'Sloppenrat',
    rank_street_punk: 'Straatpunk',
    rank_thug: 'Zware Jongen',
    rank_thief: 'Dief',
    rank_hustler: 'Ritselaar',
    rank_gangster: 'Gangster',
    rank_enforcer: 'Enforcer',
    rank_hitman: 'Huurmoordenaar',
    rank_soldato: 'Soldato',
    rank_capo: 'Capo',
    rank_consigliere: 'Consigliere',
    rank_underboss: 'Underboss',
    rank_boss: 'Boss',
    rank_don: 'Don',
    rank_godfather: 'Peetvader',

    // Rebirth (prestige)
    rebirth_title: 'Rebirth',
    rebirth_desc:
      'Je hebt Peetvader bereikt — de top van de voedselketen. Begin opnieuw op straat met een permanente +50% geld- & XP-bonus en 10% snellere cooldowns (max 50%). Stapelt met elke Rebirth.',
    rebirth_button: 'Rebirth',
    rebirth_confirm_text:
      'Je rang wordt gereset naar Sloppenrat (level 1). Je geld blijft. Dit kan niet ongedaan worden gemaakt.',
    rebirth_confirm_button: 'Ja, begin sterker opnieuw',
    rebirth_cancel: 'Annuleren',
    rebirth_done:
      'HERBOREN! De straten fluisteren je naam. Je verdient nu +{bonus}% geld en XP op alles.',
    vip_badge: 'VIP',
    error_not_godfather: 'Alleen een Peetvader kan herboren worden.',

    // Misdaad namen + omschrijvingen
    crime_pickpocket: 'Zakkenrollen',
    crime_pickpocket_desc: 'Makkelijk geld van onoplettende toeristen.',
    crime_rob_store: 'Winkel Beroven',
    crime_rob_store_desc: 'Snel geld, maar de eigenaar kan terugvechten.',
    crime_steal_car: 'Auto Stelen',
    crime_steal_car_desc: 'Kortsluiten en snel naar de sloperij.',
    crime_warehouse_heist: 'Warenhuis Heist',
    crime_warehouse_heist_desc: 'Overval op een warenhuis voor grote buit.',
    crime_train_murder: 'Train Your MurderSkill',
    crime_train_murder_desc: 'Oefen je moordvaardigheden. Riskante PvP training.',
  },
} as const;

export type Language = keyof typeof translations;
export type TranslationKey = keyof (typeof translations)['en'];
