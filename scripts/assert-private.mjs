import { execFileSync } from 'node:child_process';
try {
  const value = execFileSync('gh', ['repo', 'view', '--json', 'isPrivate', '--jq', '.isPrivate'], { encoding: 'utf8' }).trim();
  if (value !== 'true') { console.error('STOP: repository is not confirmed Private. Do not publish the update or APK. The owner must change visibility.'); process.exit(1); }
  console.log('Repository visibility verified: Private. Distribution still requires the owner’s approval.');
} catch {
  console.error('Could not verify repository visibility. Check the GitHub connection in Arena; never paste credentials into chat.'); process.exit(1);
}
