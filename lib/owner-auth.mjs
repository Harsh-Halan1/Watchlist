export async function firebase(config, operation, body) {
  const url = 'https://identitytoolkit.googleapis.com/v1/accounts:' + operation + '?key=' + encodeURIComponent(config.firebaseKey);
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    cache: 'no-store', signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Firebase could not complete the authentication request.');
  return response.json();
}

export async function verifyEmailLink(config, code) {
  const credential = await firebase(config, 'signInWithEmailLink', { email: config.ownerEmail, oobCode: code });
  return verifyOwner(config, credential);
}

export async function verifyPassword(config, password) {
  const credential = await firebase(config, 'signInWithPassword', {
    email: config.ownerEmail, password, returnSecureToken: true,
  });
  return verifyOwner(config, credential);
}

async function verifyOwner(config, credential) {
  const account = await firebase(config, 'lookup', { idToken: credential.idToken });
  const user = account.users?.[0];
  if (!user?.emailVerified || user.email?.toLowerCase() !== config.ownerEmail || !user.localId) {
    throw new Error('This account cannot access the tracker.');
  }
  return { uid: user.localId, email: config.ownerEmail };
}

