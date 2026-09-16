import { useCallback } from 'react';
import { PRESET_COLORS } from '../../../../core/utils/theme';
import Tooltip from '../../../components/Tooltip';

interface ColorPaletteProps {
  value: string;
  onChange: (color: string) => void;
}

/**
 * Color palette component with 12 preset swatches and a native color picker
 * for custom color selection. Replaces the old 5-hardcoded-color inline UI.
 */
export default function ColorPalette({ value, onChange }: ColorPaletteProps) {
  const handlePresetClick = useCallback(
    (color: string) => {
      onChange(color);
    },
    [onChange],
  );

  const handleCustomChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value);
    },
    [onChange],
  );

  const isPresetMatch = (presetColor: string) =>
    value.toLowerCase() === presetColor.toLowerCase();

  return (
    <div className="color-palette">
      <div className="color-palette-grid">
        {PRESET_COLORS.map((preset) => {
          const selected = isPresetMatch(preset.color);
          return (
            <Tooltip key={preset.color} label={preset.name}>
              <button
                type="button"
                className={`color-swatch ${selected ? 'color-swatch-active' : ''}`}
                style={{ backgroundColor: preset.color }}
                onClick={() => handlePresetClick(preset.color)}
                aria-label={preset.name}
              />
            </Tooltip>
          );
        })}
      </div>
      <div className="color-palette-custom">
        <Tooltip label="自定义颜色"><label className="color-picker-wrapper">
          <input
            type="color"
            className="color-picker-input"
            value={value}
            onChange={handleCustomChange}
          />
          <span className="color-picker-display" style={{ backgroundColor: value }} />
          <span className="color-picker-hex">{value.toUpperCase()}</span>
        </label></Tooltip>
      </div>
    </div>
  );
}
