
import React, { useRef, useEffect } from 'react';
import { usePlayer } from '../contexts/PlayerContext';

interface AudioVisualizerProps {
  isPlaying: boolean;
}

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ isPlaying }) => {
  const { analyser } = usePlayer();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Use a smaller FFT size for visualizer to have wider bars
    const bufferLength = analyser.frequencyBinCount; 
    const dataArray = new Uint8Array(bufferLength);
    let animationId: number;

    const draw = () => {
      animationId = requestAnimationFrame(draw);
      
      analyser.getByteFrequencyData(dataArray);

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const width = canvas.width;
      const height = canvas.height;
      
      // We only use the lower frequency range for better visuals (first 2/3 of bins)
      const usableBins = Math.floor(bufferLength * 0.7);
      const barWidth = (width / usableBins) * 1.5; 
      let x = 0;

      for (let i = 0; i < usableBins; i++) {
        const barHeight = (dataArray[i] / 255) * height;

        // Draw curved/rounded bar
        ctx.fillStyle = `rgba(150, 150, 150, ${dataArray[i] / 255 * 0.8})`; 
        
        // Center alignment logic if desired, but left-to-right is standard for frequency
        // Let's mirror it for "Pop" aesthetic? No, standard spectrum is fine.
        
        // Draw Rounded Rect manually or just Rect
        if (barHeight > 0) {
            const y = height - barHeight;
            const radius = 2;
            
            ctx.beginPath();
            ctx.moveTo(x, y + radius);
            ctx.lineTo(x, height);
            ctx.lineTo(x + barWidth - 1, height);
            ctx.lineTo(x + barWidth - 1, y + radius);
            ctx.quadraticCurveTo(x + barWidth - 1, y, x + barWidth - 1 - radius, y);
            ctx.lineTo(x + radius, y);
            ctx.quadraticCurveTo(x, y, x, y + radius);
            ctx.fill();
        }

        x += barWidth;
      }
    };

    if (isPlaying) {
        draw();
    } else {
        // Draw one last frame (flat or current state) or clear
        // Ideally we keep the bars if paused, but clearing implies stopped
        // Let's clear to indicate pause state visually
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Draw a flat line or simple dots to show "ready"
        ctx.fillStyle = "rgba(200, 200, 200, 0.3)";
        ctx.fillRect(0, canvas.height - 2, canvas.width, 2);
    }

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [analyser, isPlaying]);

  // Fallback if no analyser (e.g. CORS failed)
  if (!analyser) {
      return (
          <div className="w-full h-8 flex items-end justify-center opacity-30">
              <div className="w-full h-[2px] bg-gray-400"></div>
          </div>
      );
  }

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
