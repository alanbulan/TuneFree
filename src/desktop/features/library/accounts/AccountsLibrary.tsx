import { useState } from 'react';
import type { AccountPlatform, PlatformAccount, PlatformPlaylist } from '../../../../core/ipc';
import AccountPlaylists from './AccountPlaylists';
import PlaylistPreview from './PlaylistPreview';
import { useAccountPlaylists } from './usePlatformAccounts';
import { usePlaylistImports } from './usePlaylistImports';

interface Props {
  accounts: PlatformAccount[];
  account: PlatformAccount;
  onSelect: (platform: AccountPlatform) => void;
  markExpired: (platform: AccountPlatform) => void;
}

/** Keyed by account identity in AccountsView so old requests cannot write into a new account. */
export default function AccountsLibrary({ accounts, account, onSelect, markExpired }: Props) {
  const cloud = useAccountPlaylists(account, markExpired);
  const imports = usePlaylistImports(account, markExpired);
  const [preview, setPreview] = useState<PlatformPlaylist | null>(null);
  return <>
    <AccountPlaylists accounts={accounts} account={account} playlists={cloud.playlists} loading={cloud.loading}
      error={cloud.error} statuses={imports.statuses} progress={imports.progress} busy={imports.busy}
      onSelect={onSelect} onReload={() => void cloud.reload()} onImport={(playlists) => void imports.start(playlists)}
      onPreview={setPreview} onCancel={imports.cancel} onRetry={() => void imports.retry()} />
    {preview && <PlaylistPreview key={preview.id} account={account} playlist={preview} busy={imports.busy}
      onClose={() => setPreview(null)} onImport={(songs) => { setPreview(null); void imports.start([preview], songs); }} markExpired={markExpired} />}
  </>;
}
