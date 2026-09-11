import React from 'react';

interface ConfirmDialogProps {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 统一的确认弹窗，替代原生 confirm()，风格与其余弹窗一致。 */
const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  title,
  message,
  confirmLabel = '确认',
  danger = false,
  onConfirm,
  onCancel,
}) => (
  <div
    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4"
    onClick={onCancel}
  >
    <div
      className="w-full max-w-md bg-white rounded-2xl p-6 shadow-2xl animate-fade-in"
      onClick={(e) => e.stopPropagation()}
    >
      <h3 className="text-lg font-bold mb-2">{title}</h3>
      {message && (
        <p className="text-sm text-gray-500 mb-5 leading-relaxed">{message}</p>
      )}
      <div className="flex space-x-3">
        <button
          onClick={onCancel}
          className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-medium text-sm"
        >
          取消
        </button>
        <button
          onClick={() => {
            onConfirm();
            onCancel();
          }}
          className={`flex-1 py-3 rounded-xl font-bold text-sm ${
            danger ? 'bg-ios-red text-white' : 'bg-black text-white'
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
);

export default ConfirmDialog;
