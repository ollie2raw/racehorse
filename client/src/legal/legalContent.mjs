/**
 * The Privacy Policy, Terms of Use and Support pages, as plain data.
 *
 * Shared by the React page (LegalPage.tsx) and scripts/prerender.mjs, so the
 * served HTML at /privacy, /terms and /support carries the same words the app
 * shows — App Review, a crawler and a signed-out reader all see one version.
 *
 * Every factual claim here is taken from the code, not from boilerplate:
 *   client/src/lib/analytics.ts       PostHog events, identify, platform, autocapture off
 *   client/src/main.tsx               client Sentry (no user attached), 10% tracing
 *   server/src/index.ts, sentryScrubbers.ts  server Sentry, 20% tracing, field scrubbing
 *   server/src/account/routes.ts      account deletion and what deliberately survives
 *   supabase/migrations/2026-10-12_user_reports_and_blocks.sql  reports / blocks
 *   client/src/components/RoomReactions.tsx  preset emotes, no free-text chat
 *   client/index.html                 Google Fonts
 *   docs/ops/app-launch-readiness/app-store.md §3 (privacy data map)
 * If one of those changes, this copy has to change with it.
 *
 * Owner-decided values (operator name, support email, minimum age, effective
 * date, PostHog location) come only from legalConfig.mjs via `legalText()`.
 * Do not type them here — scripts/legalPlaceholders.test.ts checks.
 *
 * Shape: each section is a heading plus blocks. A string block is a
 * paragraph; an array block is a bulleted list.
 */
import { legalText, posthogDerivesLocation } from './legalConfig.mjs';

const operator = legalText('LEGAL_ENTITY_NAME');
const supportEmail = legalText('SUPPORT_EMAIL');
const minimumAge = legalText('MINIMUM_AGE');
const effectiveDate = legalText('POLICY_EFFECTIVE_DATE');

/*
 * OWNER DECISION (legalConfig.mjs → POSTHOG_LOCATION). The default — and the
 * truth until the owner turns on "Discard client IP data" in PostHog — is that
 * PostHog derives an approximate location from the IP address.
 */
const analyticsLocationSentence = posthogDerivesLocation()
  ? 'When analytics events reach PostHog, PostHog may work out an approximate location, such as your country, region or city, from your IP address.'
  : 'PostHog is set to discard IP addresses, so analytics does not work out your location.';

export const PRIVACY_POLICY = {
  id: 'privacy',
  eyebrow: 'Legal',
  title: 'Privacy Policy',
  effective: `Effective ${effectiveDate}`,
  standfirst:
    'What Racehorse Dominoes collects when you use the website at playracehorse.com or the iOS app, why, who helps us run the service, and how to delete your account.',
  sections: [
    {
      id: 'who-we-are',
      heading: 'Who we are',
      blocks: [
        `Racehorse Dominoes ("Racehorse", "we", "us") is operated by ${operator}. This policy covers the website at playracehorse.com and the Racehorse Dominoes app for iOS.`,
      ],
    },
    {
      id: 'what-we-collect',
      heading: 'What we collect',
      blocks: [
        'When you create an account:',
        [
          'Your email address and password. The password is stored only in hashed form by our sign-in provider; we never see it.',
          'Your username, which other players can see.',
        ],
        'When you play:',
        [
          'Games, ratings and match history: Daily Fritz and Puzzle Rush runs, matches against Fritz and against other players, your rating history, ghost profiles built from how you play, and the move records used to check and replay results.',
          'Friends and social activity: friend requests and friendships, and the automatic activity-feed entries posted when games finish. These entries show usernames, including your opponent’s.',
          'Reports and blocks: if you report or block a player, we store who reported or blocked whom, the reason you picked from a fixed list (inappropriate username, harassment, cheating or other) and whether it came from a profile or a live match. Reports never contain text you type.',
          'Tournament history, if you take part in tournaments.',
        ],
        'In-match reactions are a fixed set of preset emotes. There is no free-text chat.',
        'Automatically, while you use Racehorse:',
        [
          'Product analytics (PostHog): named events such as a game being opened or completed, the share button being tapped, and steps in a tournament, with details like the mode and date. Each event also carries whether you are on the website or the iOS app, and basic device information: operating system, browser or app, screen size, the page you were on and the page that sent you there. PostHog stores an analytics identifier on your device; when you sign in, it is linked to your account id. Automatic click capture is switched off.',
          'Diagnostics (Sentry): error reports and a sample of performance measurements from the app and the game server, including device and browser details. Error reports from the app are not tagged with your account. Error reports from the game server can include your account id, and may include your IP address; passwords, sign-in tokens and email fields are filtered out before they are sent.',
          'Logs: our hosting providers keep standard request logs, which include IP addresses, and our sign-in provider keeps authentication logs. The game server also uses IP addresses briefly, in memory, to limit abusive request rates.',
        ],
        'On your device we store your sign-in session, preferences such as sound, the analytics identifier, and what is needed to recover an interrupted match.',
      ],
    },
    {
      id: 'how-we-use-it',
      heading: 'How we use it',
      blocks: [
        [
          'To run your account: sign-in, password resets and email changes.',
          'To show your username, ratings, results, friends and activity to you and to other players, including on leaderboards and public profiles.',
          'To match you with opponents, verify results and keep games fair.',
          'To enforce blocks and review reports.',
          'To understand which parts of Racehorse are used, so we can improve them.',
          'To find and fix errors and performance problems, and to protect the service from abuse.',
        ],
      ],
    },
    {
      id: 'who-helps-us',
      heading: 'Service providers',
      blocks: [
        'We use these providers to run Racehorse. They handle data on our behalf, for the purposes above:',
        [
          'Supabase: database and account sign-in. Stores your account, profile and game data.',
          'Render: hosts the game server and keeps its logs.',
          'Vercel: hosts the website and keeps its request logs.',
          'PostHog: product analytics.',
          'Sentry: error and performance diagnostics.',
          'Google Fonts: the website and the app load their fonts from Google’s servers, so Google receives your IP address and browser details when the fonts load.',
        ],
        'Some of these providers process data outside your country, including in the United States.',
      ],
    },
    {
      id: 'analytics-and-location',
      heading: 'Analytics and location',
      blocks: [
        analyticsLocationSentence,
        'Racehorse does not ask for or collect your precise location from your device.',
      ],
    },
    {
      id: 'no-ads',
      heading: 'No ads, no tracking, no data sales',
      blocks: [
        'We do not show ads, we do not sell your personal information, and we do not share it for advertising. We do not track you across other companies’ apps or websites.',
      ],
    },
    {
      id: 'retention',
      heading: 'How long we keep it',
      blocks: [
        'Account and game data is kept while you have an account, and removed when you delete it, as described below. Analytics records, diagnostic records and provider logs are kept for the retention periods of the services that hold them.',
      ],
    },
    {
      id: 'deleting-your-account',
      heading: 'Deleting your account',
      blocks: [
        'You can delete your account at any time in Settings → Delete account, by typing your username to confirm. Deletion happens straight away and cannot be undone. Removing the app or clearing your browser does not delete your account.',
        'Deleting your account removes:',
        [
          'Your sign-in: email address and password.',
          'Your profile and username. The username becomes available for someone else to take.',
          'Your friends, your game history and ratings, your Daily Fritz and Puzzle Rush runs, and ghost profiles built from your play.',
          'Reports you filed, reports about you, and blocks in either direction.',
        ],
        'Some information survives in a form that no longer links to your account:',
        [
          'Results of games you played against other people stay in their history, so their records and ratings still add up. Your account id is removed from shared match results, or no longer points to any account; you appear as an unknown player.',
          'Activity-feed entries in other players’ feeds about a game against you may still show the username you had at the time.',
          'Records already held by PostHog and Sentry, and provider logs, are not removed by in-app deletion. They are kept for those services’ retention periods. Contact us if you have questions about them.',
        ],
      ],
    },
    {
      id: 'your-choices',
      heading: 'Your choices and requests',
      blocks: [
        'You can change your username, email address and password in Settings at any time.',
        `To ask about, correct, or get a copy of the personal information we hold about you, contact us at ${supportEmail}.`,
      ],
    },
    {
      id: 'children',
      heading: 'Children',
      blocks: [
        `Racehorse Dominoes is not directed at children. You must be ${minimumAge} or older to create an account. If you believe a child under that age has an account, contact us at ${supportEmail} so it can be removed.`,
      ],
    },
    {
      id: 'security',
      heading: 'Security',
      blocks: [
        'Connections to Racehorse use encryption in transit (HTTPS), and access to account data is restricted to the services that need it. No system is perfectly secure, so use a password you do not use anywhere else.',
      ],
    },
    {
      id: 'changes',
      heading: 'Changes to this policy',
      blocks: [
        'If we change this policy, we will update the effective date at the top of this page. If a change is significant, we will say so in the app or on the website.',
      ],
    },
    {
      id: 'contact',
      heading: 'Contact',
      blocks: [`Questions about privacy: ${supportEmail}.`],
    },
  ],
};

export const TERMS_OF_USE = {
  id: 'terms',
  eyebrow: 'Legal',
  title: 'Terms of Use',
  effective: `Effective ${effectiveDate}`,
  standfirst:
    'The rules for using Racehorse Dominoes, on the website and in the iOS app. By creating an account or playing, you agree to them.',
  sections: [
    {
      id: 'about',
      heading: 'About these terms',
      blocks: [
        `These terms are an agreement between you and ${operator}, which operates Racehorse Dominoes. Our Privacy Policy explains how we handle your information.`,
      ],
    },
    {
      id: 'eligibility',
      heading: 'Who can use Racehorse',
      blocks: [
        `You must be ${minimumAge} or older to create an account. Some modes can be played without an account; those are covered by these terms too.`,
      ],
    },
    {
      id: 'your-account',
      heading: 'Your account',
      blocks: [
        'Keep your sign-in details to yourself, and use a real email address you can access, since it is how you reset your password. You are responsible for what happens on your account. One person, one account: do not share accounts or use extra accounts to manipulate ratings or leaderboards.',
      ],
    },
    {
      id: 'usernames',
      heading: 'Usernames',
      blocks: [
        'Your username is public. It must not impersonate someone else, and must not be offensive, hateful, sexual or harassing. Racehorse filters some names automatically, but the filter is not the whole rule: we may ask you to change a username, or change or remove it ourselves, if it breaks these terms.',
      ],
    },
    {
      id: 'conduct',
      heading: 'How to treat other players',
      blocks: [
        'Racehorse is a competitive game; keep the competition in the game. Do not harass, threaten, abuse or target other players, including through usernames, reactions or repeated unwanted friend requests or invites.',
        'If someone makes the game worse for you, use Report or Block on their profile, or Report from the reactions menu during a match. Blocking stops friend requests and invites between you, ends any friendship, keeps you out of each other’s matches, and hides them from your activity feed. We review reports, but we cannot promise a particular outcome or response time.',
      ],
    },
    {
      id: 'fair-play',
      heading: 'Fair play',
      blocks: [
        [
          'Play your own games. Do not use bots, scripts, engines or other automated help in games against other players, in Daily Fritz or in Puzzle Rush.',
          'Do not exploit bugs, interfere with other players’ connections, or tamper with the app, the game server or results.',
          'Do not deliberately lose, trade wins or coordinate with another player to manipulate ratings or leaderboards.',
        ],
        'If you find a bug that affects results, please tell us rather than using it.',
      ],
    },
    {
      id: 'enforcement',
      heading: 'Suspension and termination',
      blocks: [
        'If you break these terms, we may remove results, reset ratings, change your username, limit features, or suspend or close your account. We will act in proportion to what happened where we can. You can stop using Racehorse and delete your account at any time.',
      ],
    },
    {
      id: 'no-gambling',
      heading: 'No gambling, prizes or purchases',
      blocks: [
        'Racehorse is free to play. There is no wagering, no betting, no real-money or prize play, and nothing to buy. Ratings, streaks, leaderboard places and tournament results have no cash value and cannot be exchanged for anything.',
      ],
    },
    {
      id: 'availability',
      heading: 'Availability',
      blocks: [
        'We work to keep Racehorse running well, but it is provided as it is and as available. We cannot guarantee that it will always be available, uninterrupted or free of errors, or that progress, ratings or results will never be lost or corrected. We may change, pause or retire features, modes or the whole service.',
      ],
    },
    {
      id: 'ownership',
      heading: 'Ownership',
      blocks: [
        'The Racehorse Dominoes app, website, game design, artwork and written content belong to us or our licensors. You may use them to play Racehorse for your own enjoyment, but not copy, resell or redistribute them.',
        'You keep whatever rights you have in your username. By using it on Racehorse, you let us display it, with your results and activity, to other players as part of running the game.',
      ],
    },
    {
      id: 'deleting',
      heading: 'Deleting your account',
      blocks: [
        'You can delete your account at any time in Settings → Delete account. What is removed and what remains is explained in the Privacy Policy.',
      ],
    },
    {
      id: 'changes',
      heading: 'Changes to these terms',
      blocks: [
        'We may update these terms as Racehorse changes. When we do, we will update the effective date at the top of this page, and say so in the app or on the website if the change is significant. If you keep playing after a change, the updated terms apply.',
      ],
    },
    {
      id: 'contact',
      heading: 'Contact',
      blocks: [`Questions about these terms: ${supportEmail}.`],
    },
  ],
};

export const SUPPORT_PAGE = {
  id: 'support',
  eyebrow: 'Help',
  title: 'Support',
  effective: null,
  standfirst:
    'Help with your account, multiplayer and staying safe in Racehorse Dominoes, and how to reach us.',
  sections: [
    {
      id: 'contact-us',
      heading: 'Contact us',
      blocks: [
        `Email ${supportEmail}. Tell us your username, whether you are on the website or the iOS app, and what happened. Please never send your password.`,
        'We reply as soon as we can, but we cannot offer a guaranteed response time.',
      ],
    },
    {
      id: 'account-and-password',
      heading: 'Account and password',
      blocks: [
        'Forgot your password? Open Sign in, enter your email address and choose “Forgot password?”. If that address has an account, we email a reset link.',
        [
          'Open the link on the same device. It opens playracehorse.com, where you choose a new password.',
          'If you play in the iOS app, go back to the app after setting the new password and sign in with it.',
          'No email? Check spam or junk, and wait a minute before asking again: reset emails are rate-limited, and asking repeatedly will be refused for a short time.',
        ],
        'Signed in already? You can change your password and email address in Settings. A new email address only takes effect after you follow the confirmation link we send to it.',
      ],
    },
    {
      id: 'delete-account',
      heading: 'Deleting your account',
      blocks: [
        'Go to Settings → Delete account, then type your username to confirm. Deletion happens straight away and cannot be undone. The Privacy Policy explains what is removed and what remains.',
      ],
    },
    {
      id: 'multiplayer',
      heading: 'Multiplayer troubleshooting',
      blocks: [
        [
          'Can’t connect: check your internet connection, then reload the page or close and reopen the app.',
          'Dropped mid-match: Racehorse tries to reconnect you automatically. If it doesn’t, reopen the app or page straight away; your seat is held for a short time.',
          'Private matches: one player creates a Private Match in Multiplayer and shares the room code; the other enters it under “Join with code”. A code only works while its room is open.',
          'Can’t find or invite someone: if either of you has blocked the other, friend requests, invites and matches between you are not possible.',
        ],
      ],
    },
    {
      id: 'reporting-and-blocking',
      heading: 'Reporting and blocking',
      blocks: [
        [
          'On a player’s profile: use Report to choose a reason, or Block to stop friend requests, invites and matches between you and hide them from your feed. You can unblock from the same place.',
          'During a match: open the reactions menu and choose Report.',
        ],
        'Reports use a fixed list of reasons and never include text you type. The player is not told who reported them.',
      ],
    },
    {
      id: 'privacy-requests',
      heading: 'Privacy requests',
      blocks: [
        `To ask about, correct, or get a copy of the information we hold about you, email ${supportEmail} from the address on your account. The Privacy Policy explains what we collect.`,
      ],
    },
  ],
};

export const LEGAL_DOCUMENTS = {
  privacy: PRIVACY_POLICY,
  terms: TERMS_OF_USE,
  support: SUPPORT_PAGE,
};
