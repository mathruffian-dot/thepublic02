
import { Injectable } from '@angular/core';

// This is a placeholder for process.env.API_KEY
// In a real applet environment, this would be populated.
// For local testing, you might need to replace it manually.
declare var process: any; 

const API_KEY_STORAGE_ITEM = 'gemini_api_key';
const API_KEY_EXPIRATION_MS = 2 * 60 * 60 * 1000; // 2 hours

export interface TeachingLog {
  subject: string;
  sessionStart: number;
  sessionEnd: number;
  modes: { name: string; totalTime: number }[];
  actions: { name: string; count: number }[];
  logs: { timestamp: number; message: string; type: string }[];
}

@Injectable({
  providedIn: 'root',
})
export class GeminiService {
  private apiKey: string | null = null;
  private model = 'gemini-2.5-flash';
  private endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;

  constructor() {
    this.loadApiKey();
  }

  private loadApiKey(): void {
    try {
      const stored = localStorage.getItem(API_KEY_STORAGE_ITEM);
      if (stored) {
        const { value, timestamp } = JSON.parse(stored);
        if (Date.now() - timestamp < API_KEY_EXPIRATION_MS) {
          this.apiKey = value;
        } else {
          this.clearApiKey();
        }
      }
    } catch (error) {
      console.error('Failed to load API key from localStorage', error);
      this.clearApiKey();
    }
  }

  setApiKey(key: string): void {
    const data = {
      value: key,
      timestamp: Date.now(),
    };
    try {
      localStorage.setItem(API_KEY_STORAGE_ITEM, JSON.stringify(data));
      this.apiKey = key;
    } catch (error) {
      console.error('Failed to save API key to localStorage', error);
    }
  }
  
  clearApiKey(): void {
      this.apiKey = null;
      try {
          localStorage.removeItem(API_KEY_STORAGE_ITEM);
      } catch (error) {
          console.error('Failed to remove API key from localStorage', error);
      }
  }

  hasApiKey(): boolean {
    this.loadApiKey(); // Re-validate on check
    return !!this.apiKey;
  }
  
  private getApiKey(): string {
    this.loadApiKey();
    if (!this.apiKey) {
      // In a real app, you might get this from an environment variable.
      // For this applet, we rely on user input.
       try {
        return process.env.API_KEY;
      } catch (e) {
         throw new Error('API 金鑰未設定或已過期。');
      }
    }
    return this.apiKey;
  }

  private async fetchWithRetry(body: object, maxRetries = 3): Promise<any> {
    const apiKey = this.getApiKey();
    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        const response = await fetch(`${this.endpoint}?key=${apiKey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          if (response.status >= 500 && attempt < maxRetries - 1) {
            throw new Error(`Server error: ${response.status}`);
          }
          const errorData = await response.json();
          throw new Error(`API Error: ${errorData.error?.message || response.statusText}`);
        }
        
        const data = await response.json();
        // Correct way to access text according to latest Gemini docs
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text === undefined) {
          console.error("Invalid response structure:", data);
          throw new Error("未能從 AI 回應中解析文本。");
        }
        return text;

      } catch (error) {
        console.error(`Attempt ${attempt + 1} failed:`, error);
        attempt++;
        if (attempt >= maxRetries) {
          throw error;
        }
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
        await new Promise(res => setTimeout(res, delay));
      }
    }
  }

  async polishText(text: string): Promise<string> {
    const prompt = `你是一位資深教育與教學顧問。請將以下這段口語化的課堂觀察筆記，改寫成專業、精簡、且符合教育專業術語的書面文字。移除贅字，聚焦於關鍵的教學行為與學生反應。

    原始筆記：
    "${text}"
    
    改寫後的專業紀錄：`;

    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 256,
      },
    };
    return this.fetchWithRetry(body);
  }

  async generateReport(logData: TeachingLog): Promise<string> {
    const formattedLogData = JSON.stringify(logData, null, 2);
    const prompt = `你是一位頂尖的 AI 教學分析師，專精於課堂觀察與教學回饋。你的任務是根據以下 JSON 格式的觀課數據，生成一份專業、深入、且結構化的 Markdown 格式觀課報告。請使用繁體中文。

    **觀課數據:**
    \`\`\`json
    ${formattedLogData}
    \`\`\`
    
    **報告生成指示:**
    請嚴格依照以下 Markdown 結構生成報告，並在各段落中提供具體的數據支持、深入的分析與可行的建議。

    # Chronos AI 數位觀課報告: ${logData.subject}

    ## 1. 整體教學風格分析
    * **教學模式分佈:** 根據計時數據，分析教師主要使用的教學模式（如：講述教學、小組討論等）及其時間佔比。
    * **教學風格判斷:** 綜合模式分佈與教學行為，判斷這堂課偏向哪種教學風格（例如：教師中心的指導式、學生中心的探究式、或是混合式教學）。

    ## 2. 師生互動與班級經營
    * **互動頻率與類型:** 根據「正向鼓勵」、「糾正規範」、「開放提問」、「封閉提問」等行為數據，分析師生互動的頻率與品質。
    * **班級氣氛:** 綜合互動數據與質性紀錄，推論班級的學習氣氛是活躍、緊張、還是沉悶？
    * **巡視與個別指導:** 根據「巡視走動」的數據，評估教師對學生個別狀況的關注程度。

    ## 3. 關鍵時刻與專注度趨勢
    * **專注度變化:** 根據紀錄的學生專注度數據，描述整堂課學生專注度的變化趨勢。
    * **轉折點分析:** 找出教學模式切換或特定教學行為發生時，是否對學生專注度產生顯著影響的「關鍵時刻」。例如：「在 '小組討論' 開始後，專注度顯著提升」。

    ## 4. 專業建議與亮點 (Strengths & Growths)
    * **教學亮點 (Strengths):** 根據數據，明確指出 2-3 個這堂課的教學優點。
    * **成長建議 (Growths):** 根據數據分析，提出 2-3 個具體、可行的專業發展建議。

    請開始生成報告。`;

    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
      },
    };
    return this.fetchWithRetry(body);
  }
}
