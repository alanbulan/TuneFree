
import React, { useRef, useEffect } from 'react';
import { usePlayer } from '../contexts/PlayerContext';

interface AudioVisualizerProps {
  isPlaying: boolean;
}

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ isPlaying }) => {
  const { analyser } = usePlayer();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Simulation State Refs (to persist across renders)
  const simDataRef = useRef<{
      values: number[], 
      targets: number[],
      phase: number
  }>({
      values: new Array(30).fill(0),
      targets: new Array(30).fill(0),
      phase: 0
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const barCount = 30;
    const dataArray = new Uint8Array(analyser ? analyser.frequencyBinCount : barCount);
    let animationId: number;

    const draw = () => {
      animationId = requestAnimationFrame(draw);
      
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);
      
      const barWidth = (width / barCount) * 0.7; 
      const gap = (width / barCount) * 0.3;
      let x = 0;

      if (analyser) {
          // --- REAL MODE (Desktop/Android) ---
          analyser.getByteFrequencyData(dataArray);
          
          const step = Math.floor(dataArray.length / barCount);
          for (let i = 0; i < barCount; i++) {
            let sum = 0;
            for(let j=0; j<step; j++) {
                sum += dataArray[i * step + j];
            }
            const value = sum / step;
            renderBar(ctx, x, value, height, barWidth);
            x += barWidth + gap;
          }

      } else {
          // --- HIGH-FIDELITY SIMULATION MODE (iOS) ---
          // Mimics gravity, kick drums, and high-frequency jitter
          const sim = simDataRef.current;
          sim.phase += 0.05;

          // 1. Simulate Kick Drum (Low Freqs - Left Side)
          // Every ~60 frames (1 sec approx), boost bass
          if (Math.random() < 0.05) { // 5% chance per frame for a beat
              for(let i=0; i<8; i++) {
                  sim.targets[i] = 200 + Math.random() * 55;
              }
          }

          // 2. Simulate Mids/Highs (Random Jitter)
          for(let i=8; i<barCount; i++) {
              if (Math.random() < 0.2) {
                  sim.targets[i] = Math.random() * 150; 
              }
          }

          // 3. Physics & Interpolation
          for (let i = 0; i < barCount; i++) {
             // Gravity: Targets decay continuously
             sim.targets[i] -= 8;
             if (sim.targets[i] < 0) sim.targets[i] = 0;

             // Elastic Movement towards target
             const diff = sim.targets[i] - sim.values[i];
             sim.values[i] += diff * 0.3; 

             // Add Sine wave flow for "alive" feel
             const flow = Math.sin(i * 0.2 + sim.phase) * 10;
             let displayValue = sim.values[i] + flow;

             // Clamp
             displayValue = Math.max(0, Math.min(255, displayValue));
             
             renderBar(ctx, x, displayValue, height, barWidth);
             x += barWidth + gap;
          }
      }
    };

    const renderBar = (context: CanvasRenderingContext2D, x: number, value: number, canvasHeight: number, bWidth: number) => {
        // Non-linear height scaling for better look
        const percent = value / 255;
        const barHeight = Math.pow(percent, 1.5) * canvasHeight; 
        
        if (barHeight > 2) {
            const y = canvasHeight - barHeight;
            const radius = 2; 
            
            // Gradient or Dynamic Color
            // Low freq (left) = slightly darker/redder? Keep simple gray/black for iOS style
            const opacity = 0.3 + (percent * 0.7);
            context.fillStyle = `rgba(100, 100, 100, ${opacity})`; 
            
            context.beginPath();
            context.moveTo(x, canvasHeight);
            context.lineTo(x, y + radius);
            context.quadraticCurveTo(x, y, x + radius, y);
            context.lineTo(x + bWidth - radius, y);
            context.quadraticCurveTo(x + bWidth, y, x + bWidth, y + radius);
            context.lineTo(x + bWidth, canvasHeight);
            context.fill();
        }
    };

    if (isPlaying) {
        draw();
    } else {
        // Resting State
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const barWidth = (canvas.width / barCount) * 0.7;
        const gap = (canvas.width / barCount) * 0.3;
        let x = 0;
        
        for (let i = 0; i < barCount; i++) {
             ctx.fillStyle = "rgba(200, 200, 200, 0.4)";
             const h = 3; 
             const y = canvas.height - h;
             ctx.fillRect(x, y, barWidth, h);
             x += barWidth + gap;
        }
        cancelAnimationFrame(animationId);
    }

    return () => cancelAnimationFrame(animationId);
  }, [analyser, isPlaying]);

  return (
    <canvas 
        ref={canvasRef} 
        width={300} 
        height={40} 
        className="w-full h-8 block"
    />
  );
};

export default AudioVisualizer;
