// 点击仓位里的“市价”平仓后，取消弹窗的 justify-content 居中（沿用旧版脚本的行为）
export function initModalFix() {
  document.addEventListener('click', (e) => {
    if (!e.target.closest('button[label="市价"]')) return;
    const checkModal = setInterval(() => {
      const modal = document.querySelector('.mantine-GateModal-inner');
      if (modal) {
        modal.style.justifyContent = 'unset';
        clearInterval(checkModal);
      }
    }, 100);
    setTimeout(() => clearInterval(checkModal), 5000);
  });
}
