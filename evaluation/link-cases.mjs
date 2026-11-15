const cases = [];
let sequence = 0;

function addCase(kind, sourceTitle, sourceContent, targetTitle, targetContent, shouldLink) {
  sequence += 1;
  const id = `${kind}-${String(sequence).padStart(2, "0")}`;
  cases.push({
    id,
    kind,
    sourcePath: `评测/${kind}/${id}-来源.md`,
    sourceTitle,
    sourceContent: `# ${sourceTitle}\n\n${sourceContent}`,
    targetPath: `评测/${kind}/${id}-目标.md`,
    targetTitle,
    targetContent: `# ${targetTitle}\n\n${targetContent}`,
    expected: shouldLink ? "target" : null
  });
}

const synonymPairs = [
  ["光合作用", "光合作用是植物利用光能制造有机物的过程。", "光合作用的另一种说法", "植物利用光能，把二氧化碳和水转化为养分。"],
  ["细胞", "细胞是生命活动的基本单位。", "细胞概念释义", "生物体结构和功能的基本单位称为细胞。"],
  ["函数", "函数用于封装可复用逻辑。", "函数概念释义", "把一段可重复使用的逻辑包装成独立单元。"],
  ["数组", "数组按连续位置保存一组数据。", "数组概念释义", "使用连续内存位置存储同类型元素的集合。"],
  ["递归", "递归函数会调用自身。", "递归概念释义", "一个过程直接或间接引用自身来完成任务。"],
  ["概率", "概率衡量事件发生的可能性。", "概率概念释义", "对随机事件出现可能性大小给出的数值度量。"],
  ["向量", "向量同时具有大小和方向。", "向量概念释义", "既有长度又有方向的数学对象。"],
  ["数据库索引", "数据库索引加快查询。", "索引概念释义", "通过额外数据结构减少检索成本并提升查询速度。"],
  ["遗忘曲线", "遗忘曲线描述记忆随时间下降。", "遗忘规律释义", "学习后保持量会随时间逐渐减少。"],
  ["主动回忆", "主动回忆强调从记忆中提取。", "提取练习释义", "不查看答案，努力把信息从长期记忆中取出来。"]
];

for (const [sourceTitle, sourceContent, targetTitle, targetContent] of synonymPairs) {
  addCase("同义改写", sourceTitle, sourceContent, targetTitle, targetContent, true);
}

const lexicalPairs = [
  ["数据库事务", "数据库事务具有原子性、一致性、隔离性和持久性。", "事务原子性", "数据库事务的原子性要求操作全部完成或全部撤销。"],
  ["间隔重复", "间隔重复按照遗忘曲线安排复习。", "复习间隔", "根据遗忘曲线安排下一次复习，就是间隔重复。"],
  ["知识图谱", "知识图谱用实体和关系组织知识。", "实体关系网络", "由实体与关系组成的知识网络称为知识图谱。"],
  ["条件概率", "条件概率描述已知事件 B 时事件 A 的概率。", "贝叶斯推理", "在已知条件下计算事件 A 的概率，是条件概率与贝叶斯推理的基础。"],
  ["线性回归", "线性回归用一条直线拟合变量关系。", "最小二乘", "线性回归常通过最小二乘法寻找最佳拟合直线。"]
];

for (const [sourceTitle, sourceContent, targetTitle, targetContent] of lexicalPairs) {
  addCase("词面重合", sourceTitle, sourceContent, targetTitle, targetContent, true);
}

// 模板噪声：所有卡片共用同一段模板骨架，仅主题词不同，主题词在整个评测集中互不重复，
// 因此任何推荐都来自模板骨架词，属于应当被抑制的误报。
const templateTopics = [
  "板块", "恒星", "酶", "渗透", "分裂",
  "食物链", "岩石", "电磁", "折射", "中和",
  "氧化", "遗传", "演替", "声波", "磁场",
  "分子", "沉积", "风化", "潮汐", "催化"
];

for (let index = 0; index < 10; index += 1) {
  const sourceTopic = templateTopics[index * 2];
  const targetTopic = templateTopics[index * 2 + 1];
  addCase(
    "模板噪声",
    `知识卡片：${sourceTopic}`,
    `主题：${sourceTopic}\n\n学习目标：理解核心概念。\n\n总结：记录关键要点。`,
    `知识卡片：${targetTopic}`,
    `主题：${targetTopic}\n\n学习目标：完成课后练习。\n\n总结：记录关键要点。`,
    false
  );
}

const unrelatedPairs = [
  ["咖啡拉花", "拉花靠奶泡流动和倾倒角度形成图案。", "黑体辐射", "黑体辐射的能谱只由温度决定。"],
  ["吉他拨弦", "拨弦让琴弦振动并通过共鸣箱放大声音。", "温室效应", "温室气体增多会让地表难以向太空散热。"],
  ["园艺修剪", "修剪能改善通风并控制植株的形状。", "极光成因", "极光来自带电粒子进入高层大气。"],
  ["瑜伽拉伸", "拉伸改善关节活动度和肌肉柔韧性。", "冰川消融", "冰川消融受气温和反照率共同影响。"],
  ["帆船操舵", "操舵通过改变帆与风向的夹角获得推力。", "火山喷发", "火山喷发把地下岩浆带到地表。"],
  ["陶艺拉坯", "拉坯靠转盘旋转和手部压力塑形。", "地震波形", "地震波形记录不同震相到达的时间。"],
  ["钓鱼打窝", "打窝用饵料把鱼聚集到钓点。", "洋流分布", "洋流分布受风带和科氏力驱动。"],
  ["滑雪转弯", "滑雪时通过刃角切入雪面来完成转向。", "季风气候", "季风气候表现为冬夏风向反转。"],
  ["插花构图", "插花构图讲究主次和留白的平衡。", "土壤结构", "土壤结构指颗粒团聚体的排列方式。"],
  ["调香配比", "调香按前中后调的挥发速度分层。", "导体电阻", "导体电阻随温度和材料而变化。"]
];

for (const [sourceTitle, sourceContent, targetTitle, targetContent] of unrelatedPairs) {
  addCase("无关笔记", sourceTitle, sourceContent, targetTitle, targetContent, false);
}

const shortPairs = [
  ["熵", "熵。", "熵的定义", "熵是系统无序程度的度量。"],
  ["导数", "导数。", "导数的定义", "导数描述函数在某一点处的瞬时变化率。"],
  ["同位素", "同位素。", "同位素的定义", "质子数相同而中子数不同的原子互称同位素。"],
  ["边际成本", "边际成本。", "边际成本定义", "边际成本是每多生产一单位产品增加的成本。"],
  ["主键", "主键。", "主键定义", "主键用于唯一标识数据表中的每一行记录。"]
];

for (const [sourceTitle, sourceContent, targetTitle, targetContent] of shortPairs) {
  addCase("短碎片", sourceTitle, sourceContent, targetTitle, targetContent, true);
}

const longPairs = [
  ["操作系统进程", "进程是程序的一次执行过程。操作系统为进程分配 CPU、内存和文件句柄。多个进程并发运行时，调度器决定执行顺序。进程之间默认隔离，不能直接访问彼此内存。需要通信时，可以使用管道、消息队列或共享内存。进程异常退出时，操作系统负责回收资源。现代系统还使用线程降低创建成本。理解进程有助于分析性能瓶颈。", "进程摘要", "进程是程序的一次执行过程，也是操作系统进行资源分配和调度的基本单位。"],
  ["机器学习过拟合", "模型在训练集表现很好但测试集表现差，通常说明发生过拟合。数据太少会增加风险。复杂模型更容易记住噪声。正则化可以限制参数。交叉验证能评估泛化能力。早停可以减少训练轮数。增加数据通常有效。特征选择也很重要。", "过拟合定义", "过拟合指模型过度学习训练数据中的噪声，导致对新数据的泛化能力下降。"],
  ["数据库范式", "范式用于减少数据冗余。第一范式要求字段原子化。第二范式消除部分依赖。第三范式消除传递依赖。高范式可能增加表连接。反范式可以换取查询性能。设计时需要权衡。业务约束决定选择。索引配合查询。迁移需要验证。", "数据库范式作用", "数据库范式通过拆分关系减少冗余和更新异常，但设计时仍需权衡查询性能。"],
  ["概率分布", "概率分布描述随机变量取各个值的可能性。离散分布使用概率质量函数。连续分布使用概率密度函数。期望反映平均水平。方差反映波动大小。正态分布常见且重要。二项分布描述独立重复试验。选择分布需要理解数据生成过程。", "概率分布含义", "概率分布完整描述随机变量取值及其对应可能性，是概率建模的基础对象。"],
  ["认知负荷", "工作记忆容量有限。学习材料过复杂会提高外在负荷。示例和图示可以帮助组织信息。分块能降低同时处理量。练习可以把知识转移到长时记忆。教学应控制信息密度。减少无关干扰很重要。主动加工比被动阅读更有效。难度过高会挫伤动机。合理挑战促进学习。", "认知负荷理论", "认知负荷理论认为学习设计应控制工作记忆负担，把认知资源用于有效加工。"]
];

for (const [sourceTitle, sourceContent, targetTitle, targetContent] of longPairs) {
  addCase("长文摘要", sourceTitle, sourceContent, targetTitle, targetContent, true);
}

const titlePairs = [
  ["入门指南：书法", "书法讲究笔画的提按顿挫与间架结构。", "入门指南：篆刻", "篆刻以刀代笔，在印面上安排朱白与章法。"],
  ["入门指南：编织", "编织通过经纬线交织形成牢固的织物。", "入门指南：陶土", "陶土经揉练排气后，才能在拉坯时保持均匀。"],
  ["入门指南：攀岩", "攀岩依靠三点固定来分配身体重心。", "入门指南：潜水", "潜水需要通过耳压平衡来应对水压变化。"],
  ["入门指南：天文", "天文观测要避开月光并选择通透的夜空。", "入门指南：地理", "地理研究地表形态与人类活动的空间分布。"],
  ["入门指南：钟表", "钟表靠擒纵机构把能量均匀释放。", "入门指南：珠宝", "珠宝的价值取决于切工、净度与颜色。"]
];

for (const [sourceTitle, sourceContent, targetTitle, targetContent] of titlePairs) {
  addCase("标题相近", sourceTitle, sourceContent, targetTitle, targetContent, false);
}

export const evaluationCases = cases;

export function buildEvaluationNotes() {
  const notes = [];
  for (const item of cases) {
    notes.push({
      path: item.sourcePath,
      title: item.sourceTitle,
      content: item.sourceContent,
      blocks: [],
      outgoingLinks: [],
      incomingLinks: [],
      tags: [],
      modifiedAt: 1
    });
    notes.push({
      path: item.targetPath,
      title: item.targetTitle,
      content: item.targetContent,
      blocks: [],
      outgoingLinks: [],
      incomingLinks: [],
      tags: [],
      modifiedAt: 1
    });
  }
  return notes;
}
