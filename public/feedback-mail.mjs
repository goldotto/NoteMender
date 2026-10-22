export const FEEDBACK_EMAIL='goldotto@proton.me';
export function feedbackMail(report,text){
  const subject=`NoteMender 反馈 · ${report.version||'未知版本'} / ${report.build||'未知构建'} · ${report.reportId||''}`;
  // mailto has no portable attachment support. Keep its URL short; the reviewed full report is separate.
  const lines=String(text||'').split('\n'),heading=lines.findIndex(l=>l==='【问题描述】');
  const summary=(heading>=0?lines.slice(heading+1,heading+7).join('\n'):String(text||'')).slice(0,120);
  const body=`问题摘要：\n${summary}\n\n报告编号：${report.reportId||''}\n构建：${report.build||'未核实'}\n\n请将已检查的完整 TXT 报告作为附件，或粘贴到邮件正文中。`;
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
