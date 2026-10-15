import { SettingsPage } from '@/components/settings-ui';
import { ThemeChooser } from '@/components/theme-chooser';
import { SECTIONS } from '@/constants/sections';

/**
 * Settings › Appearance: which theme, or follow the phone. The chooser itself
 * is shared with setup's theme step (`components/theme-chooser.tsx`).
 */
export default function AppearanceSettings() {
  return (
    <SettingsPage
      title="Appearance"
      {...SECTIONS.appearance}
      intro="How Peace looks. Nothing about your records changes — only the colours they are drawn in."
      testID="settings-appearance">
      <ThemeChooser />
    </SettingsPage>
  );
}
