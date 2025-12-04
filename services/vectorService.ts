
import { pipeline, env } from '@xenova/transformers';
import { Job } from '../types';

// Force Transformers.js to use the remote Hugging Face CDN (Reliable)
env.allowLocalModels = false;
env.useBrowserCache = true;

// --- MEMORY MANAGEMENT STATE ---
let extractorInstance: any = null; // Holds the actual pipeline
let extractorPromise: Promise<any> | null = null; // Holds the loading promise
let modelLoadFailed = false;

// Auto-cleanup timer
let idleTimer: any = null;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 Minutes

// Store vectors in memory: { jobId: Float32Array }
// We KEEP the vectors (lightweight) but drop the model (heavy)
const vectorStore: Record<string, Float32Array> = {};

// Log callback for UI notifications about memory state
let systemLogger: ((msg: string, type: 'info' | 'warning' | 'success') => void) | null = null;

export const setVectorLogger = (logger: (msg: string, type: any) => void) => {
    systemLogger = logger;
};

const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    
    idleTimer = setTimeout(async () => {
        if (extractorInstance) {
            console.log("Vector Model Idle Timeout. Releasing memory...");
            if (systemLogger) systemLogger("RAG Model idle for 5m. Unloading to free memory.", "info");
            
            // Xenova/Transformers v2.x doesn't always have a strict 'dispose' method on the pipeline object itself,
            // but setting it to null allows GC to reclaim the WebAssembly memory.
            // If strictly needed, env.backends.onnx.wasm.dispose() can be used in some versions.
            extractorInstance = null; 
            extractorPromise = null;
        }
    }, IDLE_TIMEOUT_MS);
};

const getExtractor = async () => {
    if (modelLoadFailed) return null;
    
    // Reset timer whenever we access the model
    resetIdleTimer();

    // 1. If already loaded, return it
    if (extractorInstance) return extractorInstance;

    // 2. If currently loading, return the existing promise
    if (extractorPromise) return extractorPromise;

    // 3. Otherwise, start loading
    if (systemLogger) systemLogger("Warming up RAG Model (25MB)...", "info");
    console.log("Initializing Transformers.js Pipeline...");
    
    extractorPromise = (async () => {
        try {
            const pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
            extractorInstance = pipe;
            if (systemLogger) systemLogger("RAG Model Ready.", "success");
            return pipe;
        } catch (e) {
            console.warn("FATAL: Failed to load Transformers Model.", e);
            if (systemLogger) systemLogger("Failed to load RAG Model. Chat will use fallback.", "warning");
            modelLoadFailed = true;
            return null;
        }
    })();

    return extractorPromise;
};

// EXPOSED INIT (Optional manual warmup)
export const initModel = async () => {
    await getExtractor();
};

// 2. Embed a single string
const embedText = async (text: string): Promise<Float32Array | null> => {
    try {
        const pipe = await getExtractor();
        if (!pipe) return null;
        
        // Generate embedding with mean pooling and normalization
        const output = await pipe(text, { pooling: 'mean', normalize: true });
        return output.data as Float32Array;
    } catch (e) {
        return null;
    }
};

// 3. Batch Indexer (Sequential Processing)
export const indexJobs = async (
    jobs: Job[], 
    onLog?: (msg: string) => void
) => {
    if (modelLoadFailed) return;
    
    // Ensure model is loaded before starting the loop
    const pipe = await getExtractor();
    if (!pipe) return;

    let newCount = 0;
    
    // Notify start if callback provided
    if (onLog && jobs.length > 0) {
        onLog(`Starting RAG Indexing for ${jobs.length} jobs...`);
    }

    // Process sequentially to keep memory usage low
    for (const job of jobs) {
        resetIdleTimer(); // Keep model alive during indexing loop

        // Idempotency: Skip if already indexed
        if (vectorStore[job.id]) continue;

        const contentToEmbed = `
            Role: ${job.title}
            Company: ${job.company}
            Location: ${job.location}
            Salary: ${job.salary || 'Not specified'}
            Visa Risk: ${job.visaRisk || 'Unknown'}
            Match Score: ${job.matchScore || 0}
            Description: ${job.description.slice(0, 300)} 
        `.trim();

        const vector = await embedText(contentToEmbed);
        if (vector) {
            vectorStore[job.id] = vector;
            newCount++;
        }
        
        // Optional: Yield to main thread every 50 items to keep UI responsive
        if (newCount % 50 === 0) {
            await new Promise(r => setTimeout(r, 10));
        }
    }
    
    if (newCount > 0) {
        const msg = `Indexed ${newCount} new jobs into Vector Store.`;
        console.log(msg);
        if (onLog) onLog(msg);
    }
};

// Manual Cosine Similarity
const cosineSimilarity = (a: Float32Array, b: Float32Array) => {
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
    }
    return dot;
};

// 4. Search
export const searchJobs = async (query: string, jobs: Job[], topK = 5): Promise<Job[]> => {
    // Attempt to load model (will trigger "Warming up..." if cold)
    const pipe = await getExtractor();
    
    // Fallback if model failed or store is empty
    if (!pipe || Object.keys(vectorStore).length === 0) {
        console.warn("Vector Search unavailable. Fallback to basic slice.");
        return jobs.sort((a,b) => (b.matchScore || 0) - (a.matchScore || 0)).slice(0, topK);
    }

    try {
        const queryVector = await embedText(query);
        if (!queryVector) return jobs.slice(0, topK);

        const results: { id: string; score: number }[] = [];

        for (const id in vectorStore) {
            const docVector = vectorStore[id];
            const score = cosineSimilarity(queryVector, docVector);
            results.push({ id, score });
        }

        results.sort((a, b) => b.score - a.score);

        const relevantJobs = results
            .slice(0, topK)
            .map(r => jobs.find(j => j.id === r.id))
            .filter((j): j is Job => !!j);
            
        return relevantJobs;

    } catch (e) {
        console.error("Vector Search Failed:", e);
        return jobs.slice(0, topK);
    }
};

export const clearVectorStore = () => {
    for (const key in vectorStore) delete vectorStore[key];
};
