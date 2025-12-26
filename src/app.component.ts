
import { Component, ChangeDetectionStrategy, signal, computed, effect, inject, WritableSignal, untracked } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GeminiService, TeachingLog } from './services/gemini.service';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

// Type definitions
interface TeachingMode {
  id: string;
  name: string;
  icon: string;
  active: WritableSignal<boolean>;
  elapsedTime: WritableSignal<number>;
}

interface TeachingAction {
  id: string;
  name: string;
  icon: string;
  count: WritableSignal<number>;
}

interface LogEntry {
  timestamp: number;
  message: string;
  type: 'mode' | 'action' | 'note' | 'engagement' | 'session';
}

declare var marked: any;

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, DatePipe],
})
export class AppComponent {
  private geminiService = inject(GeminiService);
  private sanitizer = inject(DomSanitizer);

  // App State Signals
  sessionActive = signal(false);
  currentTime = signal(new Date());
  sessionStartTime = signal<number | null>(null);
  
  subjects = ['國文', '英文', '數學', '物理', '化學', '生物', '地理', '歷史', '公民'];
  selectedSubject = signal(this.subjects[0]);

  // Modals visibility
  isSettingsModalVisible = signal(false);
  isSummaryModalVisible = signal(false);
  isApiKeyMissingPromptVisible = signal(false);
  
  // API Key
  tempApiKey = signal('');
  hasApiKey = signal(false);

  // AI interaction state
  isLoadingAI = signal(false);
  aiReportContent = signal('');
  isPolishingNote = signal(false);

  // Teaching Modes
  teachingModes: WritableSignal<TeachingMode[]> = signal([
    { id: 'lecture', name: '講述教學', icon: 'presentation', active: signal(false), elapsedTime: signal(0) },
    { id: 'group-discussion', name: '小組討論', icon: 'users', active: signal(false), elapsedTime: signal(0) },
    { id: 'practice', name: '實作/演算', icon: 'edit-3', active: signal(false), elapsedTime: signal(0) },
    { id: 'digital-tool', name: '數位運用', icon: 'cpu', active: signal(false), elapsedTime: signal(0) },
  ]);

  // Teaching Actions
  teachingActions: WritableSignal<TeachingAction[]> = signal([
    { id: 'praise', name: '正向鼓勵', icon: 'thumbs-up', count: signal(0) },
    { id: 'correction', name: '糾正規範', icon: 'alert-triangle', count: signal(0) },
    { id: 'open-question', name: '開放提問', icon: 'message-circle', count: signal(0) },
    { id: 'closed-question', name: '封閉提問', icon: 'help-circle', count: signal(0) },
    { id: 'patrol', name: '巡視走動', icon: 'walk', count: signal(0) },
  ]);

  // Logs
  logs = signal<LogEntry[]>([]);

  // Footer state
  qualitativeNote = signal('');
  engagementLevel = signal<'high' | 'medium' | 'low'>('medium');
  engagementValue = signal(50);
  lastEngagementLogTime = signal<number | null>(null);
  needsEngagementReminder = signal(false);


  // Computed values
  sessionDuration = computed(() => {
    if (!this.sessionActive() || !this.sessionStartTime()) return '00:00:00';
    const diff = Math.floor((this.currentTime().getTime() - this.sessionStartTime()!) / 1000);
    return this.formatTime(diff);
  });
  
  sanitizedAiReportContent = computed(() => {
    if (this.aiReportContent()) {
      const rawHtml = marked.parse(this.aiReportContent());
      return this.sanitizer.bypassSecurityTrustHtml(rawHtml);
    }
    return '';
  });

  engagementColor = computed(() => {
    const value = this.engagementValue();
    if (value > 66) return 'bg-green-500';
    if (value > 33) return 'bg-yellow-500';
    return 'bg-red-500';
  });

  constructor() {
    // Check for API key on startup
    this.hasApiKey.set(this.geminiService.hasApiKey());

    // Main clock effect
    effect(() => {
        const timer = setInterval(() => {
            this.currentTime.set(new Date());
        }, 1000);
        return () => clearInterval(timer);
    }, {allowSignalWrites: true});

    // Session timer effect for modes
    effect(() => {
      if (this.sessionActive()) {
        const timer = setInterval(() => {
          this.teachingModes().forEach(mode => {
            if (mode.active()) {
              mode.elapsedTime.update(t => t + 1);
            }
          });
        }, 1000);
        return () => clearInterval(timer);
      }
    }, {allowSignalWrites: true});

    // Engagement reminder effect
    effect(() => {
        if(this.sessionActive()) {
            const reminderCheck = setInterval(() => {
                const now = Date.now();
                const lastLogTime = this.lastEngagementLogTime();
                const sessionStart = this.sessionStartTime();

                // Check after 5 minutes of session start or last log
                const timeSinceLastAction = now - (lastLogTime || sessionStart || now);
                if (timeSinceLastAction > 5 * 60 * 1000) {
                     this.needsEngagementReminder.set(true);
                } else {
                     this.needsEngagementReminder.set(false);
                }
            }, 10000); // Check every 10 seconds
             return () => clearInterval(reminderCheck);
        } else {
            this.needsEngagementReminder.set(false);
        }
    }, {allowSignalWrites: true});
  }

  // Methods
  formatTime(seconds: number): string {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  addLog(message: string, type: LogEntry['type']) {
    this.logs.update(currentLogs => [{ timestamp: Date.now(), message, type }, ...currentLogs].slice(0, 100));
  }

  toggleSession() {
    const isActive = this.sessionActive();
    if (isActive) { // Stopping
      this.sessionActive.set(false);
      this.addLog('觀課結束', 'session');
      this.isSummaryModalVisible.set(true);
    } else { // Starting
      // Reset state
      this.logs.set([]);
      this.teachingModes().forEach(m => {
        m.active.set(false);
        m.elapsedTime.set(0);
      });
      this.teachingActions().forEach(a => a.count.set(0));
      this.qualitativeNote.set('');
      this.aiReportContent.set('');
      this.engagementValue.set(50);
      this.lastEngagementLogTime.set(null);
      this.needsEngagementReminder.set(false);
      
      this.sessionActive.set(true);
      this.sessionStartTime.set(Date.now());
      this.addLog(`觀課開始 - 科目: ${this.selectedSubject()}`, 'session');
    }
  }

  toggleTeachingMode(mode: TeachingMode) {
    if (!this.sessionActive()) return;
    mode.active.update(v => !v);
    this.addLog(`${mode.name} ${mode.active() ? '啟用' : '停用'}`, 'mode');
  }

  recordAction(action: TeachingAction) {
    if (!this.sessionActive()) return;
    action.count.update(c => c + 1);
    this.addLog(`紀錄: ${action.name}`, 'action');
  }

  onEngagementChange(event: Event) {
    if (!this.sessionActive()) return;
    const value = parseInt((event.target as HTMLInputElement).value, 10);
    this.engagementValue.set(value);
    
    let level: 'high' | 'medium' | 'low';
    if (value > 66) level = 'high';
    else if (value > 33) level = 'medium';
    else level = 'low';
    this.engagementLevel.set(level);
    
    this.addLog(`學生專注度: ${level === 'high' ? '高' : level === 'medium' ? '中' : '低'}`, 'engagement');
    this.lastEngagementLogTime.set(Date.now());
    this.needsEngagementReminder.set(false);
  }

  submitQualitativeNote() {
    if (!this.sessionActive() || !this.qualitativeNote().trim()) return;
    this.addLog(`質性紀錄: ${this.qualitativeNote()}`, 'note');
    this.qualitativeNote.set('');
  }

  saveApiKey() {
    if (this.tempApiKey()) {
      this.geminiService.setApiKey(this.tempApiKey());
      this.hasApiKey.set(true);
      this.isSettingsModalVisible.set(false);
      this.isApiKeyMissingPromptVisible.set(false);
      this.tempApiKey.set('');
    }
  }
  
  private checkApiKey(): boolean {
    if (!this.geminiService.hasApiKey()) {
        this.isApiKeyMissingPromptVisible.set(true);
        return false;
    }
    return true;
  }
  
  async polishNote() {
      if (!this.checkApiKey() || !this.qualitativeNote().trim()) return;
      
      this.isPolishingNote.set(true);
      try {
        const polished = await this.geminiService.polishText(this.qualitativeNote());
        this.qualitativeNote.set(polished);
      } catch (error) {
        console.error('Error polishing note:', error);
        alert('AI 潤飾時發生錯誤，請稍後再試。');
      } finally {
        this.isPolishingNote.set(false);
      }
  }

  generateFullLog(): TeachingLog {
      return {
          subject: this.selectedSubject(),
          sessionStart: this.sessionStartTime()!,
          sessionEnd: Date.now(),
          modes: this.teachingModes().map(m => ({name: m.name, totalTime: m.elapsedTime()})),
          actions: this.teachingActions().map(a => ({name: a.name, count: a.count()})),
          logs: [...this.logs()].reverse() // chronological order
      };
  }

  async generateAiReport() {
    if (!this.checkApiKey()) return;

    this.isLoadingAI.set(true);
    this.aiReportContent.set('');
    try {
        const fullLog = this.generateFullLog();
        const report = await this.geminiService.generateReport(fullLog);
        this.aiReportContent.set(report);
    } catch (error) {
        console.error('Error generating AI report:', error);
        this.aiReportContent.set('### 報告生成失敗\n\n抱歉，與 AI 連線時發生錯誤。請檢查您的 API 金鑰是否正確，或稍後再試。');
    } finally {
        this.isLoadingAI.set(false);
    }
  }

  copyLogToClipboard() {
    const logData = this.generateFullLog();
    let reportText = `Chronos AI 觀課紀錄\n`;
    reportText += `科目: ${logData.subject}\n`;
    reportText += `開始時間: ${new Date(logData.sessionStart).toLocaleString()}\n`;
    reportText += `結束時間: ${new Date(logData.sessionEnd).toLocaleString()}\n\n`;
    reportText += `--- 教學模式計時 ---\n`;
    logData.modes.forEach(m => {
        reportText += `${m.name}: ${this.formatTime(m.totalTime)}\n`;
    });
    reportText += `\n--- 教學行為計次 ---\n`;
    logData.actions.forEach(a => {
        reportText += `${a.name}: ${a.count} 次\n`;
    });
    reportText += `\n--- 詳細事件紀錄 ---\n`;
    logData.logs.forEach(l => {
        reportText += `[${new Date(l.timestamp).toLocaleTimeString()}] ${l.message}\n`;
    });
    
    navigator.clipboard.writeText(reportText).then(() => {
        alert('紀錄已複製到剪貼簿！');
    }).catch(err => {
        console.error('Failed to copy log:', err);
        alert('複製失敗，請稍後再試。');
    });
  }

  downloadLogAsTxt() {
    const logData = this.generateFullLog();
    let reportText = `Chronos AI 觀課紀錄\n`;
    reportText += `科目: ${logData.subject}\n`;
    reportText += `開始時間: ${new Date(logData.sessionStart).toLocaleString()}\n`;
    reportText += `結束時間: ${new Date(logData.sessionEnd).toLocaleString()}\n\n`;
    reportText += `--- 教學模式計時 ---\n`;
    logData.modes.forEach(m => {
        reportText += `${m.name}: ${this.formatTime(m.totalTime)}\n`;
    });
    reportText += `\n--- 教學行為計次 ---\n`;
    logData.actions.forEach(a => {
        reportText += `${a.name}: ${a.count} 次\n`;
    });
    reportText += `\n--- 詳細事件紀錄 ---\n`;
    logData.logs.forEach(l => {
        reportText += `[${new Date(l.timestamp).toLocaleTimeString()}] ${l.message}\n`;
    });
    
    // Add BOM for UTF-8 compatibility in Windows
    const blob = new Blob(['\uFEFF' + reportText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.download = `Chronos-AI-Log-${timestamp}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
