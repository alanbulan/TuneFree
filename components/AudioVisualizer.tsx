
import React, { useRef, useEffect } from 'react';
import { usePlayer } from '../contexts/PlayerContext';

interface AudioVisualizerProps {
  isPlaying: boolean;
}

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ isPlaying }) => {
  const { analyser } = usePlayer();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Configuration
  const BAR_COUNT = 64; // Higher count for thinner bars
  
  // State Refs for persistence
  const stateRef = useRef({
      // Simulation state
      simValues: new Array(BAR_COUNT).fill(0),
      simTargets: new Array(BAR_COUNT).fill(0),
      phase: 0,
      
      // Real data smoothing state
      realValues: new Array(BAR_COUNT).fill(0)
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle High DPI
    const dpr = window.devicePixelRatio || 1;
    // We rely on CSS width/height, so get bounding rect
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const dataArray = new Uint8Array(analyser ? analyser.frequencyBinCount : 0);
    let animationId: number = 0;

    const draw = () => {
      animationId = requestAnimationFrame(draw);
      
      const width = rect.width;
      const height = rect.height;
      ctx.clearRect(0, 0, width, height);
      
      // Styling: Thinner bars
      const totalSpace = width / BAR_COUNT;
      const barWidth = totalSpace * 0.5; // Bar is half the slot width
      const gap = totalSpace * 0.5;
      
      // Start slightly offset to center visual weight
      let x = gap / 2;

      const state = stateRef.current;

      if (analyser) {
          // --- REAL MODE (Desktop/Android) ---
          analyser.getByteFrequencyData(dataArray);
          
          // Determine how many bins to aggregate per bar
          // fftSize 512 -> 256 bins. 256 / 64 = 4 bins per bar.
          const step = Math.floor(dataArray.length / BAR_COUNT) || 1;
          
          for (let i = 0; i < BAR_COUNT; i++) {
            let sum = 0;
            let count = 0;
            for(let j=0; j<step; j++) {
                if (dataArray[i * step + j] !== undefined) {
                    sum += dataArray[i * step + j];
                    count++;
                }
            }
            const rawValue = count > 0 ? sum / count : 0;
            
            // Apply smoothing (Linear Interpolation)
            // prev * alpha + curr * (1 - alpha)
            state.realValues[i] = state.realValues[i] * 0.6 + rawValue * 0.4;
            
            renderBar(ctx, x, state.realValues[i], height, barWidth);
            x += totalSpace;
          }

      } else {
          // --- SIMULATION MODE (iOS/Safari) ---
          // Optimized for "Realism" and "Thinner" look
          state.phase += 0.03; // Slower, more organic phase

          // 1. Kick / Bass (Left side, indices 0-12)
          if (Math.random() < 0.05) { // Random beat trigger
              const kickStrength = 180 + Math.random() * 75;
              // Affect first few bars heavily
              for(let i=0; i<12; i++) {
                   const decay = 1 - (i/12); // Stronger at 0
                   state.simTargets[i] = Math.max(state.simTargets[i], kickStrength * decay);
              }
          }

          // 2. Mids / Highs (Indices 12-63)
          // Create a flowing noise floor
          for(let i=0; i<BAR_COUNT; i++) {
              // Base curve: High at bass, lower at treble
              const baseProfile = Math.max(0, 80 - i); 
              
              // Perlin-ish noise via sine superposition
              const noise = (Math.sin(i * 0.3 + state.phase) + Math.sin(i * 0.7 - state.phase)) * 20;
              
              let target = baseProfile + Math.abs(noise);
              
              // Random high-freq flickers
              if (i > 15 && Math.random() < 0.05) {
                  target += Math.random() * 100 * (i / BAR_COUNT); // Higher flicker in treble
              }
              
              // Don't override big kick peaks immediately
              state.simTargets[i] = Math.max(state.simTargets[i], target);
          }

          // 3. Physics (Decay & Lerp)
          for (let i = 0; i < BAR_COUNT; i++) {
             // Decay the target peak
             state.simTargets[i] -= 3;
             if (state.simTargets[i] < 0) state.simTargets[i] = 0;

             // Move value towards target
             const diff = state.simTargets[i] - state.simValues[i];
             state.simValues[i] += diff * 0.3; // Snappy response

             renderBar(ctx, x, state.simValues[i], height, barWidth);
             x += totalSpace;
          }
      }
    };

    const renderBar = (ctx: CanvasRenderingContext2D, x: number, val: number, h: number, w: number) => {
        // Clamp and Scale
        // Map 0-255 input to 0-height pixels
        // Apply a curve so quiet sounds are visible but loud ones don't clip too hard
        let percent = Math.max(0, Math.min(1, val / 255));
        
        // Minimum visibility
        if (percent < 0.03) percent = 0.03;
        
        // Scale to canvas height (leave a tiny bit of headroom)
        const barHeight = percent * h;

        const radius = w / 2;
        const y = h - barHeight;

        ctx.fillStyle = "rgba(0, 0, 0, 0.25)"; // Subtle dark gray
        
        ctx.beginPath();
        // Modern rounded bar
        // Cast to any to check for property existence without narrowing type to 'never' in else block
        if ('roundRect' in (ctx as any)) {
            // @ts-ignore
            ctx.roundRect(x, y, w, barHeight, radius);
        } else {
            // Fallback for older browsers
            ctx.moveTo(x + radius, y);
            ctx.lineTo(x + w - radius, y);
            ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
            ctx.lineTo(x + w, h - radius);
            ctx.quadraticCurveTo(x + w, h, x + w - radius, h);
            ctx.lineTo(x + radius, h);
            ctx.quadraticCurveTo(x, h, x, h - radius);
            ctx.lineTo(x, y + radius);
            ctx.quadraticCurveTo(x, y, x + radius, y);
        }
        ctx.fill();
    };

    if (isPlaying) {
        draw();
    } else {
        // Render Static "Paused" State - Flat line
        ctx.clearRect(0, 0, rect.width, rect.height);
        const totalSpace = rect.width / BAR_COUNT;
        const barWidth = totalSpace * 0.5;
        const gap = totalSpace * 0.5;
        let x = gap / 2;
        
        ctx.fillStyle = "rgba(0, 0, 0, 0.1)";
        for (let i = 0; i < BAR_COUNT; i++) {
             const h = 4; // Small dot height
             const y = rect.height - h;
             if ('roundRect' in (ctx as any)) {
                // @ts-ignore
                ctx.roundRect(x, y, barWidth, h, barWidth/2);
             } else {
                ctx.fillRect(x, y, barWidth, h);
             }
             ctx.fill();
             x += totalSpace;
        }
        cancelAnimationFrame(animationId);
    }

    return () => cancelAnimationFrame(animationId);
  }, [analyser, isPlaying]);

  return (
    <canvas 
        ref={canvasRef} 
        className="w-full h-full block"
    />
  );
};

export default AudioVisualizer;
