
import React, { useState, useEffect } from 'react';
import { 
    getStatsSummary, getSystemHealth, getTrends, 
    getPlatformStats, getQpsStats, getRequestTypeStats, getSystemStatus, getOverallStats, checkLatency 
} from '../services/api';
import { StatsSummary, TrendStats, PlatformStats, QpsStats, RequestTypeStats, SystemStatus, OverallStats } from '../types';
import { Activity, Server, BarChart3, Radio, Zap, Cpu, Clock, Timer, Network } from 'lucide-react';
import { formatUptime, formatBytes } from '../utils/formatting';

const StatusDashboard: React.FC = () => {
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('today');
  
  // Data States
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [overallStats, setOverallStats] = useState<OverallStats | null>(null);
  const [trends, setTrends] = useState<TrendStats | null>(null);
  const [health, setHealth] = useState<string>('checking');
  const [platformStats, setPlatformStats] = useState<PlatformStats | null>(null);
  const [qpsStats, setQpsStats] = useState<QpsStats | null>(null);
  const [typeStats, setTypeStats] = useState<RequestTypeStats | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemStatus | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);

    const fetchData = async () => {
        // Parallel requests for all stats endpoints
        const [h, s, o, t, p, q, r, sys, lat] = await Promise.all([
            getSystemHealth(),
            getStatsSummary(),
            getOverallStats(period), // Endpoint #12
            getTrends(period),
            getPlatformStats(period),
            getQpsStats(period),
            getRequestTypeStats(period),
            getSystemStatus(),
            checkLatency()
        ]);

        if (isMounted) {
            setHealth(h?.status || 'unknown');
            setStats(s);
            setOverallStats(o);
            setTrends(t);
            setPlatformStats(p);
            setQpsStats(q);
            setTypeStats(r);
            setSystemInfo(sys?.data || sys);
            setLatency(lat);
            setIsLoading(false);
        }
    };

    fetchData();

    // Set up a latency poller
    const interval = setInterval(async () => {
        const lat = await checkLatency();
        if (isMounted) setLatency(lat);
    }, 5000);

    return () => { 
        isMounted = false; 
        clearInterval(interval);
    };
  }, [period]);

  const getSuccessColor = (rate: number) => {
      if (rate >= 95) return 'text-green-600 bg-green-500';
      if (rate >= 80) return 'text-yellow-600 bg-yellow-500';
      return 'text-red-600 bg-red-500';
  };

  const getLatencyColor = (ms: number) => {
      if (ms < 0) return 'text-red-500';
      if (ms < 200) return 'text-green-500';
      if (ms < 500) return 'text-yellow-500';
      return 'text-red-500';
  };

  return (
    <div className="space-y-4 pb-24 animate-fade-in">
        {/* Header & Controls */}
        <div className="flex items-center justify-between bg-white p-4 rounded-2xl shadow-sm">
            <h2 className="font-bold text-lg flex items-center gap-2">
                <Activity className="text-ios-blue" size={20} />
                <span>系统监控</span>
            </h2>
            <div className="flex bg-gray-100 rounded-lg p-1">
                {(['today', 'week', 'month'] as const).map((p) => (
                    <button
                        key={p}
                        onClick={() => setPeriod(p)}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                            period === p 
                            ? 'bg-white text-black shadow-sm' 
                            : 'text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        {p === 'today' ? '今日' : p === 'week' ? '本周' : '本月'}
                    </button>
                ))}
            </div>
        </div>

        {isLoading && !health ? (
            <div className="flex justify-center py-8">
                <div className="w-6 h-6 border-2 border-ios-blue border-t-transparent rounded-full animate-spin"></div>
            </div>
        ) : (
            <>
                {/* Status Overview Grid */}
                <div className="grid grid-cols-2 gap-3">
                    {/* Endpoint #11 Health */}
                    <div className={`p-4 rounded-2xl shadow-sm text-white ${health === 'healthy' ? 'bg-green-500' : 'bg-orange-500'} transition-colors`}>
                        <div className="text-xs opacity-80 mb-1">系统健康度</div>
                        <div className="font-bold text-lg uppercase flex items-center gap-2">
                            {health}
                            <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                        </div>
                    </div>
                    
                    {/* Real-time Latency (Frontend -> Backend) */}
                    <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
                        <div className="flex items-center gap-2 text-gray-500 mb-2">
                            <Network size={14} />
                            <span className="text-xs">API 延迟</span>
                        </div>
                        <div className={`font-bold text-lg flex items-end gap-1 ${latency ? getLatencyColor(latency) : 'text-gray-400'}`}>
                            {latency && latency > 0 ? latency : '--'}
                            <span className="text-xs font-normal text-gray-400 mb-1">ms</span>
                        </div>
                    </div>
                </div>

                {/* Endpoint #12 Overall Stats (Avg Duration) */}
                {overallStats && (
                    <div className="bg-white p-5 rounded-2xl shadow-sm flex items-center justify-between">
                         <div className="flex items-center gap-3">
                             <div className="p-2 bg-blue-50 text-ios-blue rounded-full">
                                 <Timer size={20} />
                             </div>
                             <div>
                                 <p className="text-xs text-gray-400">平均处理耗时</p>
                                 <p className="font-bold text-gray-800">{overallStats.overall.avg_duration.toFixed(2)} ms</p>
                             </div>
                         </div>
                         <div className="h-8 w-px bg-gray-100"></div>
                         <div className="flex flex-col items-end">
                             <p className="text-xs text-gray-400">调用总数</p>
                             <p className="font-bold text-gray-800">{overallStats.overall.total_calls.toLocaleString()}</p>
                         </div>
                    </div>
                )}

                {/* Endpoint #10 System Resources */}
                {systemInfo?.memory && (
                    <div className="bg-white p-5 rounded-2xl shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                             <div className="flex items-center gap-2 text-gray-700">
                                <Cpu size={18} />
                                <h3 className="font-bold text-sm">系统资源</h3>
                             </div>
                             <div className="flex items-center gap-1 text-xs text-gray-400">
                                 <Clock size={12} />
                                 <span>运行时长: {formatUptime(systemInfo.uptime || 0)}</span>
                             </div>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <div className="flex justify-between text-xs mb-1">
                                    <span className="text-gray-500">Heap Usage</span>
                                    <span className="font-medium">{formatBytes(systemInfo.memory.heapUsed)} / {formatBytes(systemInfo.memory.heapTotal)}</span>
                                </div>
                                <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                                    <div 
                                        className="bg-ios-blue h-full rounded-full transition-all duration-1000"
                                        style={{ width: `${(systemInfo.memory.heapUsed / systemInfo.memory.heapTotal) * 100}%` }}
                                    ></div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Endpoint #15 QPS Stats */}
                    {qpsStats && (
                        <div className="bg-white p-5 rounded-2xl shadow-sm">
                            <div className="flex items-center gap-2 mb-4 text-ios-blue">
                                <Zap size={20} />
                                <h3 className="font-bold text-gray-800">QPS (每秒查询)</h3>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-blue-50 p-3 rounded-xl">
                                    <p className="text-xs text-blue-400 mb-1">Avg</p>
                                    <p className="text-xl font-bold text-blue-600">{qpsStats.qps.avg_qps}</p>
                                </div>
                                <div className="bg-purple-50 p-3 rounded-xl">
                                    <p className="text-xs text-purple-400 mb-1">Peak</p>
                                    <p className="text-xl font-bold text-purple-600">{qpsStats.qps.peak_qps}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Endpoint #17 Request Types */}
                    {typeStats && (
                        <div className="bg-white p-5 rounded-2xl shadow-sm">
                            <div className="flex items-center gap-2 mb-4 text-ios-text">
                                <Radio size={20} />
                                <h3 className="font-bold">接口类型分布</h3>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                {Object.entries(typeStats.requestTypes).map(([key, val]: [string, any]) => (
                                    <div key={key} className="bg-gray-50 p-3 rounded-xl border border-gray-100 flex flex-col justify-between">
                                        <p className="text-[10px] text-gray-400 uppercase mb-1">{key}</p>
                                        <div className="flex justify-between items-end">
                                            <span className="font-bold text-gray-800 text-sm">{val.total_calls}</span>
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${val.success_rate > 90 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                                {val.success_rate}%
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Endpoint #14 Platform Stats */}
                {platformStats && (
                    <div className="bg-white p-5 rounded-2xl shadow-sm">
                        <div className="flex items-center gap-2 mb-4 text-ios-text">
                            <Server size={20} />
                            <h3 className="font-bold">各平台可用性</h3>
                        </div>
                        <div className="space-y-4">
                            {Object.entries(platformStats.platforms).map(([key, val]: [string, any]) => {
                                const colorClass = getSuccessColor(val.success_rate);
                                const bgClass = colorClass.split(' ')[1];
                                const textClass = colorClass.split(' ')[0];
                                
                                return (
                                    <div key={key} className="flex flex-col">
                                        <div className="flex justify-between items-end mb-1">
                                            <span className="text-sm font-semibold uppercase">{key}</span>
                                            <div className="text-xs text-gray-400 flex gap-2">
                                                <span>{val.total_calls} Calls</span>
                                                <span className={`font-bold ${textClass}`}>{val.success_rate}%</span>
                                            </div>
                                        </div>
                                        <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                                            <div 
                                                className={`h-full rounded-full ${bgClass}`} 
                                                style={{ width: `${val.success_rate}%` }}
                                            ></div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Endpoint #16 & #12 Trends */}
                {stats && (
                    <div className="bg-white p-5 rounded-2xl shadow-sm">
                        <div className="flex items-center gap-2 mb-4 text-ios-text">
                            <BarChart3 size={20} />
                            <h3 className="font-bold text-gray-800">趋势概览</h3>
                        </div>
                        
                        {period === 'today' && (
                            <div className="grid grid-cols-2 gap-4 mb-6">
                                <div className="bg-gray-50 p-4 rounded-xl">
                                    <p className="text-xs text-gray-400">今日总计</p>
                                    <p className="text-xl font-bold text-ios-blue">{stats.today?.total_calls.toLocaleString()}</p>
                                </div>
                                <div className="bg-gray-50 p-4 rounded-xl">
                                    <p className="text-xs text-gray-400">综合成功率</p>
                                    <p className="text-xl font-bold text-ios-blue">{stats.today?.success_rate}%</p>
                                </div>
                            </div>
                        )}

                        <div className="h-40 flex items-end justify-between gap-1 pt-4 border-t border-gray-100">
                            {trends?.trends && trends.trends.length > 0 ? trends.trends.slice(-7).map((t, i) => {
                                const max = Math.max(...trends.trends.map(x=>x.total_calls)) || 1;
                                const height = Math.max(10, (t.total_calls / max) * 100);
                                return (
                                    <div key={i} className="flex-1 flex flex-col items-center group relative">
                                        <div className="absolute bottom-full mb-2 hidden group-hover:block bg-black text-white text-[10px] py-1 px-2 rounded z-10 whitespace-nowrap">
                                            {t.date}: {t.total_calls}
                                        </div>
                                        <div 
                                            className="w-full mx-0.5 bg-ios-blue/20 rounded-t-sm hover:bg-ios-blue transition-colors relative"
                                            style={{ height: `${height}%` }}
                                        ></div>
                                        <span className="text-[9px] text-gray-400 mt-2 transform -rotate-45 origin-left w-full overflow-hidden text-ellipsis">{t.date.slice(5)}</span>
                                    </div>
                                )
                            }) : (
                                <div className="w-full text-center text-gray-300 text-xs py-10">暂无趋势数据</div>
                            )}
                        </div>
                    </div>
                )}
            </>
        )}
    </div>
  );
};

export default StatusDashboard;
