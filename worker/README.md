# Comp-Art sync server

A Cloudflare Worker (`worker.js`) plus one R2 storage bucket. It keeps each
person's projects so they can open them on all their devices. The app does
the merging; the Worker stores files, checks sync codes and enforces the
limits. Everything is set up in Cloudflare's website, with nothing to install.

Cost: Cloudflare's free tier (10 GB of storage, about 200 full projects).
Past that, storage is $0.015 per GB a month.

## Codes

- **Invite code**: you choose it. Anyone who has it can create a sync
  account (Sync › New account). It shows nobody's projects. Change it at any
  time; existing accounts keep working.
- **Sync code**: made by the server for each account. It opens that
  account's projects and nothing else. Each person enters theirs once on each
  of their devices.
- **Admin key**: you choose it, and only you have it. It opens the admin
  screen (⋯ › Sync › Admin…), where you can see every account and its
  projects, and turn accounts off and on or delete them.

Use long, random invite codes and admin keys, for example from a password
manager. Letters and digits only for the invite code: it's compared ignoring
case, spaces and punctuation, so those add nothing.

## Setting it up (about 10 minutes)

1. **Account.** Sign up (free) at <https://dash.cloudflare.com>.
2. **Storage.**
   1. In the left menu, open **R2 Object Storage**.
   2. Cloudflare asks for a payment card before R2 can be used, even on the
      free tier. Nothing is charged within the free limits.
   3. Click **Create bucket**, name it `comp-art-sync`, keep the other
      settings as they are, and click **Create bucket**.
3. **The Worker.**
   1. In the left menu, open **Workers & Pages** (under Compute), click
      **Create**, choose **Start with Hello World!**, and name it
      `comp-art-sync`.
   2. Click **Deploy**, then **Edit code**.
   3. Delete everything in the editor, paste in the whole of `worker.js`,
      and click **Deploy**.
4. **Connect the storage.**
   1. In the Worker, open **Settings › Bindings › Add › R2 bucket**.
   2. Set the variable name to `BUCKET` (exactly), choose `comp-art-sync`,
      and click **Deploy**.
5. **Secrets.**
   1. In **Settings › Variables and Secrets**, click **Add**.
   2. Set the type to **Secret** and add:
      - `INVITE_CODE`: your invite code
      - `ADMIN_KEY`: your admin key
   3. Click **Deploy**.
6. **Check it works.** The Worker's address is shown at the top of its page,
   e.g. `https://comp-art-sync.yourname.workers.dev`. Opening it in a browser
   should show `{"app":"comp-art-sync","ok":true}`.
7. **Make it the app's default.** Send the address to be put in
   `DEFAULT_URL` at the top of `sync.js`. Then nobody has to type it. Until
   then, enter it in the Sync dialog's "Sync server" box.

## In the app

- **First device:** ⋯ › Sync › New account. Enter your name and the invite
  code, then tap Turn on sync. Your sync code is shown; keep it somewhere
  safe.
- **Other devices:** ⋯ › Sync › I have a sync code. Enter it and tap Join.
- **Admin:** ⋯ › Sync › Admin…. Enter the admin key once; the device
  remembers it until you tap Forget admin key.

## Changing things later

- **New invite code:** Worker › Settings › Variables and Secrets, edit
  `INVITE_CODE`.
- **Limits:** the numbers at the top of `worker.js`. Edit them in Edit code,
  then Deploy:
  - `PROJECT_LIMIT` (10 projects per account)
  - `ACCOUNT_BYTES` (1 GB of storage per account)
  - `MAX_FILE` (40 MB per photo)
- **Updates to `worker.js`:** paste the new version in Edit code and Deploy.
  Stored files are kept.
- **Spending alerts:** Cloudflare's billing page can email you if anything
  is ever charged.
