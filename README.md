# Anime Tracker

Browse your AniList watchlist, search for anime, and log episodes as they air.

## Run locally on Windows

Use Node.js 22 or later. Open PowerShell in the `watchlist` folder. If the original prototype is running on port 4173, stop it first.

```powershell
npm.cmd install
npm.cmd run dev
```

Open [Anime Tracker](http://127.0.0.1:4173) and choose **Connect AniList**. The app can reuse the prototype's parent `.env`. For a standalone copy, create `.env.local` from `.env.example` and set `ANILIST_CLIENT_ID` and `ANILIST_CLIENT_SECRET`. Register `http://127.0.0.1:4173/oauth/callback` as the redirect URL in your [AniList developer settings](https://anilist.co/settings/developer). Restarting the app clears the session and requires reconnecting.

Use the sun or moon button in the header to switch themes. The app starts with your system preference and saves your selection in this browser.

## Track a show

- **Add anime** searches AniList for a title or season. Open a result to set progress and status.
- **+1** logs one episode for a show in **Continue Watching**. **Edit** lets you change the episode count or the watch status.
- Airing cards show the watched, aired, and total counts when available, plus the next scheduled episode in your browser's local time. If 9 of 12 episodes have aired, the tracker accepts up to 9. Choose **Refresh** to check the latest schedule.
- If AniList's schedule is missing or stale, you can keep or lower your saved count and change the watch status. If you previously saved a count above the airing limit, use **Edit** to correct it.
- When AniList marks a title as finished and you have watched every episode, it appears under **Completed**. Saving that progress also records **Completed** on AniList. For older fully watched entries, open **Edit** and save to sync the status back to AniList. Caught-up airing shows stay in their current category.

## Find recommendations

Open **For You** after connecting AniList. Picks come from community recommendations for up to six titles you’ve started or completed. The tracker prioritizes higher personal scores and skips titles you rated under 70 out of 100, dropped titles, and titles you haven’t started. It excludes adult titles and anything already on your watchlist. Use **Refresh picks** after updating your AniList history or ratings.

Use **Airing now** or **Finished airing** to filter by AniList’s release status. AniList tags can flag sexual content, but a missing tag leaves the fanservice level unknown. If you know a pick has low fanservice, mark it on its card. **Low fanservice** shows those marks on the current browser.

Select a poster in the watchlist, search results, or **For You** to see a larger image, genres, the AniList community score, and the synopsis when available. Choose **Read more** to expand a long synopsis.

## Verify locally

Set `WATCHLIST_DEMO=1` in `.env.local` and restart. In **Continue Watching**, Overgeared starts at 8 watched and 9 aired. Click **+1** once and confirm the card says **Caught Up**. Open **Edit** and try to save 10. The form should block the save. The **Missing schedule** entry lets you check how the app displays unavailable schedule data. Demo changes reset on restart.

Run `npm.cmd test` for the server tests and `npm.cmd run build` for a production build.


## Prepare a private Vercel deployment

1. In Vercel, set the project root to the folder containing this `package.json`. Keep `.env` and `.env.local` out of Git.
2. In a Firebase project dedicated to the tracker, enable **Email/Password** and **Email link (passwordless sign-in)** under Authentication. Add the production hostname under **Authorized domains**. In Authentication's email templates, set the custom action URL to `https://YOUR-PRODUCTION-DOMAIN/oauth/email-link`. The tracker handles sign-in links, so use a dedicated Firebase project.
3. Create a production AniList client with redirect URL `https://YOUR-PRODUCTION-DOMAIN/oauth/callback`. Keep the local client for development.
4. Set these variables for **Production** in Vercel, then redeploy.

| Variable | Value |
| --- | --- |
| `APP_ORIGIN` | Your stable HTTPS production origin, without a path |
| `ANILIST_CLIENT_ID` | Production AniList client ID |
| `ANILIST_CLIENT_SECRET` | Production AniList client secret |
| `FIREBASE_API_KEY` | Web API key from the Firebase project |
| `OWNER_EMAIL` | The single email address allowed to access the tracker |
| `SESSION_SECRET` | A stable 32-byte random secret encoded as 64 hexadecimal characters |

Generate the session secret locally:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Open the canonical production URL, request a link, open it, and select **Continue**. Then connect AniList. Each browser needs its own sign-in and AniList connection. Sessions last seven days and survive server restarts while the same session secret is configured. Progress is shared through AniList. The existing local setup continues to use AniList directly when the owner sign-in variables are unset.

## Set an owner password

Use the existing Firebase user whose verified address matches `OWNER_EMAIL`. If the account has never signed in, choose **Use an email link instead** in the tracker and complete sign-in once.

In Firebase Console, open **Authentication → Users** and send a password reset email for that existing account. Set a unique password using the link, then use **Sign in** in the tracker. If the Firebase project uses a custom email action handler that only handles sign-in links, an administrator can instead [set the password on the existing Firebase user by UID](https://firebase.google.com/docs/auth/admin/manage-users#update_a_user).

Use the same Firebase project and Vercel environment variables. The email link remains available as a fallback.

