import React from 'react';

export interface FilterState {
  visa: 'ALL' | 'LOW' | 'MEDIUM' | 'HIGH';
  matchBand: 'ALL' | 'TOP' | 'MID' | 'LOW';
  easyApply: boolean;
  recency: 'ANY' | 'RECENT';
}

interface FilterBarProps {
  filters: FilterState;
  onChange: (next: FilterState) => void;
}

export const FilterBar: React.FC<FilterBarProps> = ({ filters, onChange }) => {
  const update = (patch: Partial<FilterState>) => onChange({ ...filters, ...patch });

  return (
    <div className="flex flex-wrap items-center gap-3 p-3 bg-white border border-gray-200 rounded-lg shadow-sm">
      <span className="text-xs font-semibold text-gray-600 uppercase">Filters</span>
      <select
        value={filters.matchBand}
        onChange={(e) => update({ matchBand: e.target.value as FilterState['matchBand'] })}
        className="px-3 py-1.5 rounded-md border border-gray-200 text-sm"
      >
        <option value="ALL">All match</option>
        <option value="TOP">Top (80%+)</option>
        <option value="MID">Mid (60-79%)</option>
        <option value="LOW">Low (&lt;60%)</option>
      </select>

      <select
        value={filters.visa}
        onChange={(e) => update({ visa: e.target.value as FilterState['visa'] })}
        className="px-3 py-1.5 rounded-md border border-gray-200 text-sm"
      >
        <option value="ALL">All visa</option>
        <option value="LOW">Visa Low</option>
        <option value="MEDIUM">Visa Medium</option>
        <option value="HIGH">Visa High</option>
      </select>

      <select
        value={filters.recency}
        onChange={(e) => update({ recency: e.target.value as FilterState['recency'] })}
        className="px-3 py-1.5 rounded-md border border-gray-200 text-sm"
      >
        <option value="ANY">Any date</option>
        <option value="RECENT">Recent (7d)</option>
      </select>

      <label className="inline-flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={filters.easyApply}
          onChange={(e) => update({ easyApply: e.target.checked })}
          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
        />
        Easy Apply only
      </label>
    </div>
  );
};
