import { useEffect, useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { TrendingUp, TrendingDown, CheckCircle2, BarChart3, Radar, ChevronRight, Award } from 'lucide-react'
import ReactECharts from 'echarts-for-react'

interface DimensionScore {
  name: string
  attempt1: number
  attempt2: number
}

interface GapImprovement {
  gapType: string
  improved: boolean
  improvement: number
  description: string
}

const dimensionScores: DimensionScore[] = [
  { name: '发音', attempt1: 65, attempt2: 72 },
  { name: '语法', attempt1: 70, attempt2: 78 },
  { name: '词汇', attempt1: 55, attempt2: 70 },
  { name: '功能达成', attempt1: 60, attempt2: 85 },
  { name: '语用得体', attempt1: 45, attempt2: 75 },
  { name: '话轮适配', attempt1: 50, attempt2: 72 },
  { name: '副语言', attempt1: 62, attempt2: 68 },
]

const gapImprovements: GapImprovement[] = [
  {
    gapType: '语用得体性',
    improved: true,
    improvement: 30,
    description: '成功使用了礼貌用语 "Could I have..." 和 "please"，语用得体性明显提升'
  },
  {
    gapType: '词汇多样性',
    improved: true,
    improvement: 15,
    description: '使用了更多咖啡相关词汇，如 "caramel macchiato"，词汇表达更加丰富'
  },
  {
    gapType: '话轮适配',
    improved: true,
    improvement: 22,
    description: '回答更加自然流畅，能够适当扩展对话内容'
  }
]

export default function EvaluatePage() {
  const [overallScore, setOverallScore] = useState(0)
  const chartRef = useRef<ReactECharts>(null)

  useEffect(() => {
    const avg1 = dimensionScores.reduce((sum, d) => sum + d.attempt1, 0) / dimensionScores.length
    const avg2 = dimensionScores.reduce((sum, d) => sum + d.attempt2, 0) / dimensionScores.length
    setOverallScore(Math.round(avg2))
  }, [])

  const radarOption = {
    radar: {
      indicator: dimensionScores.map(d => ({ name: d.name, max: 100 })),
      shape: 'polygon',
      splitNumber: 5,
      axisName: {
        color: '#666',
        fontSize: 12
      },
      splitLine: {
        lineStyle: {
          color: ['#eee', '#ddd', '#ccc', '#bbb', '#aaa']
        }
      },
      splitArea: {
        show: true,
        areaStyle: {
          color: ['rgba(99, 102, 241, 0.05)', 'rgba(99, 102, 241, 0.1)']
        }
      },
      axisLine: {
        lineStyle: {
          color: '#ccc'
        }
      }
    },
    series: [{
      type: 'radar',
      data: [
        {
          value: dimensionScores.map(d => d.attempt1),
          name: '第一次尝试',
          lineStyle: { color: '#94a3b8' },
          areaStyle: { color: 'rgba(148, 163, 184, 0.3)' },
          itemStyle: { color: '#94a3b8' }
        },
        {
          value: dimensionScores.map(d => d.attempt2),
          name: '第二次尝试',
          lineStyle: { color: '#10b981' },
          areaStyle: { color: 'rgba(16, 185, 129, 0.3)' },
          itemStyle: { color: '#10b981' }
        }
      ]
    }]
  }

  const barOption = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' }
    },
    legend: {
      data: ['第一次尝试', '第二次尝试'],
      top: 0
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: dimensionScores.map(d => d.name),
      axisLabel: {
        interval: 0,
        rotate: 30,
        fontSize: 11
      }
    },
    yAxis: {
      type: 'value',
      max: 100
    },
    series: [
      {
        name: '第一次尝试',
        type: 'bar',
        data: dimensionScores.map(d => d.attempt1),
        itemStyle: { color: '#94a3b8' }
      },
      {
        name: '第二次尝试',
        type: 'bar',
        data: dimensionScores.map(d => d.attempt2),
        itemStyle: { color: '#10b981' }
      }
    ]
  }

  const handleContinue = () => {
    localStorage.setItem('evaluation', JSON.stringify({ dimensionScores, gapImprovements, overallScore }))
    window.location.href = '/report'
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-indigo-100 text-indigo-700 px-4 py-2 rounded-full text-sm font-medium mb-4">
            <BarChart3 className="w-4 h-4" />
            双轨评价
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">学习评价</h1>
          <p className="text-gray-600">对比两次对话表现，查看你的学习进步</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 mb-8">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-24 h-24 bg-gradient-to-br from-green-500 to-emerald-600 rounded-full mb-4">
              <span className="text-4xl font-bold text-white">{overallScore}</span>
            </div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">综合得分</h2>
            <p className="text-gray-600">第二次尝试的综合评分</p>
            <div className="mt-4 inline-flex items-center gap-2 bg-green-100 text-green-700 px-4 py-2 rounded-full">
              <TrendingUp className="w-4 h-4" />
              <span className="font-medium">整体进步明显</span>
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Radar className="w-5 h-5 text-indigo-600" />
              七维能力雷达图
            </h3>
            <ReactECharts option={radarOption} style={{ height: '300px' }} ref={chartRef} />
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-indigo-600" />
              两轮表现对比
            </h3>
            <ReactECharts option={barOption} style={{ height: '300px' }} />
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Award className="w-5 h-5 text-amber-600" />
            靶向评估 - 核心不足改善情况
          </h3>
          <div className="space-y-4">
            {gapImprovements.map((gap, index) => (
              <div key={index} className="bg-gray-50 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-medium text-gray-900">{gap.gapType}</span>
                  <div className={`flex items-center gap-1 px-3 py-1 rounded-full ${
                    gap.improved ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}>
                    {gap.improved ? (
                      <>
                        <TrendingUp className="w-4 h-4" />
                        <span className="font-medium">+{gap.improvement}%</span>
                      </>
                    ) : (
                      <>
                        <TrendingDown className="w-4 h-4" />
                        <span className="font-medium">无改善</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className={`w-5 h-5 ${gap.improved ? 'text-green-500' : 'text-gray-400'}`} />
                  <span className="text-gray-600 text-sm">{gap.description}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl p-6 mb-8">
          <h3 className="text-lg font-semibold text-white mb-2">总体评价</h3>
          <p className="text-white/90 mb-4">
            你的第二次对话表现相比第一次有了显著提升！在语用得体性、词汇多样性和话轮适配方面都取得了明显进步。
            特别是语用得体性，从命令式语言转变为礼貌请求，这是一个非常好的改进！
          </p>
          <div className="flex items-center gap-2 text-white/80 text-sm">
            <CheckCircle2 className="w-4 h-4" />
            <span>核心不足已得到有效改善</span>
          </div>
        </div>

        <div className="flex justify-center">
          <Button 
            size="lg" 
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-8"
            onClick={handleContinue}
          >
            查看完整学习证据链
            <ChevronRight className="ml-2 w-5 h-5" />
          </Button>
        </div>
      </div>
    </div>
  )
}