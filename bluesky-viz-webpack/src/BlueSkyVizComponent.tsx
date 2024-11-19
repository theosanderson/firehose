import React, { useEffect } from 'react';
import { BlueSkyViz } from './index';

const BlueSkyVizComponent: React.FC = () => {
  useEffect(() => {
    const viz = new BlueSkyViz();
    return () => {
      viz.dispose();
    };
  }, []);

  return <canvas id="renderCanvas"></canvas>;
};

export default BlueSkyVizComponent;
