import AppearanceSettingsCard from './settings/AppearanceSettingsCard';
import DownloadSettingsCard from './settings/DownloadSettingsCard';
import RecommendationSettingsCard from './settings/RecommendationSettingsCard';
import StorageAndBackupColumn from './settings/StorageAndBackupColumn';
import { useSettingsViewModel } from './settings/useSettingsViewModel';

export default function SettingsView() {
  const model = useSettingsViewModel();

  return (
    <section className="settings-grid">
      <DownloadSettingsCard model={model.core} />
      <AppearanceSettingsCard model={model.appearance} />
      <RecommendationSettingsCard model={model.recommendation} />
      <StorageAndBackupColumn model={model.backup} />
    </section>
  );
}
