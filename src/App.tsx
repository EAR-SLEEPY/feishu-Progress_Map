import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  bitable,
  dashboard,
  DashboardState,
  FieldType,
  IConfig,
  IFieldMeta,
  ITableMeta,
  ISingleSelectField,
  IMultiSelectField
} from '@lark-base-open/js-sdk';
import { Timeline, DataSet } from 'vis-timeline/standalone';
import 'vis-timeline/styles/vis-timeline-graph2d.css';

type CommentLine = {
  dateText: string;
  commentText: string;
  sortTime: number;
};

type OverlayBlock = {
  taskId: string;
  left: number;
  comments: CommentLine[];
};

type CommentDateGroup = {
  dateText: string;
  comments: CommentLine[];
};

type AxisAnchor = {
  dateKey: string;
  left: number;
  top: number;
};

type TaskDecoration = {
  taskId: string;
  left: number;
  segments: Array<{
    top: number;
    height: number;
  }>;
};

type PluginConfig = {
  selectedTableId: string;
  groupFieldId: string;
  titleFieldId: string;
  dateFieldId: string;

  filterFieldId1: string;
  selectedFilterVals1: string[];

  filterFieldId2: string;
  selectedFilterVals2: string[];

  commentTableId: string;
  commentRelationFieldId: string;
  commentTextFieldId: string;
  commentDateFieldId: string;

  commentFontSize: number;
  commentBlockWidth: number;
};

const AUTO_REFRESH_MS = 4000;

function App() {
  const isConfigMode =
    dashboard.state === DashboardState.Create || dashboard.state === DashboardState.Config;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<Timeline | null>(null);
  const timelineHandlersRef = useRef<{ [key: string]: any }>({});
  const autoRefreshTimerRef = useRef<number | null>(null);
  const lastDataSignatureRef = useRef<string>('');
  const isPageVisibleRef = useRef<boolean>(true);
  const expandedCommentTaskIdsRef = useRef<Set<string>>(new Set());

  const [tables, setTables] = useState<ITableMeta[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string>('');
  const [fields, setFields] = useState<IFieldMeta[]>([]);

  const [groupFieldId, setGroupFieldId] = useState<string>('');
  const [titleFieldId, setTitleFieldId] = useState<string>('');
  const [dateFieldId, setDateFieldId] = useState<string>('');

  const [filterFieldId1, setFilterFieldId1] = useState<string>('');
  const [filterOptions1, setFilterOptions1] = useState<string[]>([]);
  const [selectedFilterVals1, setSelectedFilterVals1] = useState<string[]>([]);

  const [filterFieldId2, setFilterFieldId2] = useState<string>('');
  const [filterOptions2, setFilterOptions2] = useState<string[]>([]);
  const [selectedFilterVals2, setSelectedFilterVals2] = useState<string[]>([]);

  const [commentTableId, setCommentTableId] = useState<string>('');
  const [commentFields, setCommentFields] = useState<IFieldMeta[]>([]);
  const [commentRelationFieldId, setCommentRelationFieldId] = useState<string>('');
  const [commentTextFieldId, setCommentTextFieldId] = useState<string>('');
  const [commentDateFieldId, setCommentDateFieldId] = useState<string>('');

  const [overlayBlocks, setOverlayBlocks] = useState<OverlayBlock[]>([]);
  const [overlayHeight, setOverlayHeight] = useState<number>(320);
  const [expandedCommentTaskIds, setExpandedCommentTaskIds] = useState<Set<string>>(
    () => new Set()
  );
  const [focusedCommentTaskId, setFocusedCommentTaskId] = useState<string>('');

  const [axisAnchors, setAxisAnchors] = useState<AxisAnchor[]>([]);
  const [taskDecorations, setTaskDecorations] = useState<TaskDecoration[]>([]);

  const [commentFontSize, setCommentFontSize] = useState<number>(13);
  const [commentBlockWidth, setCommentBlockWidth] = useState<number>(420);

  const [isConfigured, setIsConfigured] = useState<boolean>(false);
  const [isRendering, setIsRendering] = useState<boolean>(false);
  const [isSavingConfig, setIsSavingConfig] = useState<boolean>(false);
  const [isConfigLoaded, setIsConfigLoaded] = useState<boolean>(false);
  const [appliedConfigVersion, setAppliedConfigVersion] = useState<number>(0);
  const [configError, setConfigError] = useState<string>('');

  const formatVal = (val: any) => {
    if (val === null || val === undefined) return '';
    if (typeof val === 'string' || typeof val === 'number') return String(val);

    if (Array.isArray(val)) {
      return val
        .map(v => {
          if (typeof v === 'string' || typeof v === 'number') return String(v);
          return v?.name || v?.text || v?.title || v?.label || v?.value || '';
        })
        .filter(Boolean)
        .join(',');
    }

    return val?.text || val?.name || val?.title || val?.label || val?.value || String(val);
  };

  const formatCommentVal = (val: any) => {
    if (val === null || val === undefined) return '';
    if (typeof val === 'string' || typeof val === 'number') return String(val);

    if (Array.isArray(val)) {
      return val
        .map(v => {
          if (typeof v === 'string' || typeof v === 'number') return String(v);
          return v?.name || v?.text || v?.title || v?.label || v?.value || '';
        })
        .filter(Boolean)
        .join('\n');
    }

    return val?.text || val?.name || val?.title || val?.label || val?.value || String(val);
  };

  const normalizeCommentText = (text: string) => {
    return String(text || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line !== '')
      .join('\n')
      .trim();
  };

  const getDateVal = (dateVal: any): Date | null => {
    if (!dateVal) return null;

    if (typeof dateVal === 'number') {
      const d = new Date(dateVal);
      return isNaN(d.getTime()) ? null : d;
    }

    if (typeof dateVal === 'string') {
      const d = new Date(dateVal);
      return isNaN(d.getTime()) ? null : d;
    }

    const raw = dateVal?.start || dateVal?.value || dateVal?.timestamp || dateVal?.time;
    if (raw) {
      const d = new Date(raw);
      return isNaN(d.getTime()) ? null : d;
    }

    return null;
  };

  const formatCommentDate = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}.${m}.${d}`;
  };

  const getDateKey = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const groupCommentsByDate = (comments: CommentLine[]): CommentDateGroup[] => {
    const groups: CommentDateGroup[] = [];

    comments.forEach(comment => {
      const lastGroup = groups[groups.length - 1];
      if (lastGroup?.dateText === comment.dateText) {
        lastGroup.comments.push(comment);
      } else {
        groups.push({ dateText: comment.dateText, comments: [comment] });
      }
    });

    return groups;
  };

  const getVisibleComments = (comments: CommentLine[], expanded: boolean) => {
    if (expanded) return comments;
    return groupCommentsByDate(comments)
      .slice(0, 3)
      .flatMap(group => group.comments);
  };

  const extractLinkedRecordIds = (val: any): string[] => {
    if (!val) return [];

    if (Array.isArray(val)) {
      return val
        .map(item => {
          if (typeof item === 'string') return item;
          return item?.recordId || item?.id || item?.value || item?.linkRecordId || '';
        })
        .filter(Boolean);
    }

    if (typeof val === 'object') {
      const one = val.recordId || val.id || val.value || val.linkRecordId || '';
      return one ? [one] : [];
    }

    return [];
  };

  const cleanupTimelineListeners = () => {
    const timeline = timelineRef.current;
    if (!timeline) return;

    if (timelineHandlersRef.current.rangechanged) {
      timeline.off('rangechanged', timelineHandlersRef.current.rangechanged);
    }
    if (timelineHandlersRef.current.changed) {
      timeline.off('changed', timelineHandlersRef.current.changed);
    }
    if (timelineHandlersRef.current.select) {
      timeline.off('select', timelineHandlersRef.current.select);
    }

    timelineHandlersRef.current = {};
  };

  const getTimelineScreenX = (timeline: Timeline, date: Date) => {
    const t: any = timeline as any;
    if (typeof t.toScreen === 'function') return t.toScreen(date);
    if (t?.body?.util?.toScreen) return t.body.util.toScreen(date);
    return 0;
  };

  const estimateOverlayHeight = (blocks: Array<{ comments: CommentLine[] }>) => {
    const blockWidth = commentBlockWidth;
    const fontSize = commentFontSize;
    const lineHeight = Math.round(fontSize * 1.55);
    let maxHeight = 220;

    blocks.forEach(block => {
      let currentHeight = 0;

      block.comments.forEach(c => {
        const fullText = `${c.dateText}：${c.commentText}`;
        const lineBreakCount = (fullText.match(/\n/g) || []).length;
        const pureTextLength = fullText.replace(/\n/g, '').length;
        const approxCharsPerLine = Math.max(12, Math.floor(blockWidth / fontSize));
        const wrappedLines = Math.ceil(pureTextLength / approxCharsPerLine);
        const totalLines = Math.max(1, wrappedLines + lineBreakCount);

        currentHeight += totalLines * lineHeight + 10;
      });

      currentHeight += 52;
      if (currentHeight > maxHeight) maxHeight = currentHeight;
    });

    return Math.max(maxHeight, 250);
  };

  const createTaskNode = (label: string, taskId: string, dateKey: string) => {
    const taskNode = document.createElement('div');
    taskNode.className = 'task-node';
    taskNode.setAttribute('data-task-id', taskId);
    taskNode.setAttribute('data-date-key', dateKey);

    const taskLabel = document.createElement('div');
    taskLabel.className = 'task-node-label';
    taskLabel.textContent = label;

    taskNode.appendChild(taskLabel);
    return taskNode;
  };

  const getAllRecords = useCallback(async (tableId: string) => {
    const table = await bitable.base.getTableById(tableId);
    const all: any[] = [];
    let pageToken: any = undefined;
    let hasMore = true;

    while (hasMore) {
      const res: any = await table.getRecordsByPage({
        pageSize: 200,
        ...(pageToken !== undefined ? { pageToken } : {})
      });

      const pageRecords = res?.records || [];
      all.push(...pageRecords);

      hasMore = Boolean(res?.hasMore);
      pageToken = res?.pageToken;
      if (!hasMore) break;
    }

    return { table, records: all };
  }, []);

  const recordMatchesOneFilter = useCallback(
    (record: any, fieldId: string, selectedVals: string[]) => {
      if (!fieldId || selectedVals.length === 0) return true;

      const recordVal = formatVal(record.fields?.[fieldId]);
      if (!recordVal) return false;

      return selectedVals.some(v => recordVal.includes(v));
    },
    []
  );

  const recordMatchesFilters = useCallback(
    (record: any) => {
      const match1 = recordMatchesOneFilter(record, filterFieldId1, selectedFilterVals1);
      const match2 = recordMatchesOneFilter(record, filterFieldId2, selectedFilterVals2);
      return match1 && match2;
    },
    [filterFieldId1, selectedFilterVals1, filterFieldId2, selectedFilterVals2, recordMatchesOneFilter]
  );

  const buildDataSignature = useCallback(async () => {
    if (!selectedTableId || !titleFieldId || !dateFieldId) return '';

    const mainRes = await getAllRecords(selectedTableId);
    const mainRows = mainRes.records.map((record: any) => {
      return {
        recordId: record.recordId,
        title: formatVal(record.fields?.[titleFieldId]),
        date: getDateVal(record.fields?.[dateFieldId])?.getTime() || 0,
        group: groupFieldId ? formatVal(record.fields?.[groupFieldId]) : '',
        filter1: filterFieldId1 ? formatVal(record.fields?.[filterFieldId1]) : '',
        filter2: filterFieldId2 ? formatVal(record.fields?.[filterFieldId2]) : ''
      };
    });

    let commentRows: any[] = [];
    if (commentTableId && commentRelationFieldId && commentTextFieldId && commentDateFieldId) {
      const commentRes = await getAllRecords(commentTableId);
      commentRows = commentRes.records.map((record: any) => ({
        recordId: record.recordId,
        relation: formatVal(record.fields?.[commentRelationFieldId]),
        linkedIds: extractLinkedRecordIds(record.fields?.[commentRelationFieldId]),
        text: normalizeCommentText(formatCommentVal(record.fields?.[commentTextFieldId])),
        date: getDateVal(record.fields?.[commentDateFieldId])?.getTime() || 0
      }));
    }

    return JSON.stringify({
      mainRows,
      commentRows,
      selectedFilterVals1: [...selectedFilterVals1].sort(),
      selectedFilterVals2: [...selectedFilterVals2].sort()
    });
  }, [
    selectedTableId,
    titleFieldId,
    dateFieldId,
    groupFieldId,
    filterFieldId1,
    selectedFilterVals1,
    filterFieldId2,
    selectedFilterVals2,
    commentTableId,
    commentRelationFieldId,
    commentTextFieldId,
    commentDateFieldId,
    getAllRecords
  ]);

  const renderTimeline = useCallback(
    async (force = false) => {
      try {
        if (!selectedTableId || !titleFieldId || !dateFieldId) return;
        if (isRendering) return;

        setIsRendering(true);

        const currentSignature = await buildDataSignature();
        if (!force && currentSignature && currentSignature === lastDataSignatureRef.current) {
          setIsConfigured(true);
          return;
        }

        const { records } = await getAllRecords(selectedTableId);

        const filteredRecords = records.filter((record: any) => {
          const dateObj = getDateVal(record.fields?.[dateFieldId]);
          if (!dateObj) return false;
          return recordMatchesFilters(record);
        });

        const taskMapById = new Map<string, any>();
        const taskMapByTitle = new Map<string, any>();
        const dateMap = new Map<string, Date>();

        filteredRecords.forEach((record: any) => {
          const groupPart = groupFieldId ? formatVal(record.fields?.[groupFieldId]) : '';
          const titlePart = formatVal(record.fields?.[titleFieldId]);
          const taskDateObj = getDateVal(record.fields?.[dateFieldId]);
          if (!taskDateObj) return;

          const dateKey = getDateKey(taskDateObj);
          if (!dateMap.has(dateKey)) dateMap.set(dateKey, taskDateObj);

          taskMapById.set(record.recordId, {
            recordId: record.recordId,
            groupPart,
            titlePart,
            start: taskDateObj,
            dateKey,
            record
          });

          if (titlePart) {
            taskMapByTitle.set(titlePart, {
              recordId: record.recordId,
              groupPart,
              titlePart,
              start: taskDateObj,
              dateKey,
              record
            });
          }
        });

        const commentMap = new Map<string, CommentLine[]>();

        if (commentTableId && commentRelationFieldId && commentTextFieldId && commentDateFieldId) {
          const commentRes = await getAllRecords(commentTableId);
          const commentRecords = commentRes.records || [];

          commentRecords.forEach((record: any) => {
            const rawCommentText = formatCommentVal(record.fields?.[commentTextFieldId]);
            const commentText = normalizeCommentText(rawCommentText);
            const commentDateObj = getDateVal(record.fields?.[commentDateFieldId]);
            if (!commentText || !commentDateObj) return;

            const relationRaw = record.fields?.[commentRelationFieldId];
            let matchedTask: any = null;

            const linkedIds = extractLinkedRecordIds(relationRaw);
            if (linkedIds.length > 0) {
              for (const id of linkedIds) {
                if (taskMapById.has(id)) {
                  matchedTask = taskMapById.get(id);
                  break;
                }
              }
            }

            if (!matchedTask) {
              const relationText = formatVal(relationRaw);
              if (relationText && taskMapByTitle.has(relationText)) {
                matchedTask = taskMapByTitle.get(relationText);
              }
            }

            if (!matchedTask) return;

            const taskId = matchedTask.recordId;
            if (!commentMap.has(taskId)) commentMap.set(taskId, []);

            commentMap.get(taskId)!.push({
              dateText: formatCommentDate(commentDateObj),
              commentText,
              sortTime: commentDateObj.getTime()
            });
          });
        }

        const timelineItems = filteredRecords
          .map((record: any) => {
            const dateObj = getDateVal(record.fields?.[dateFieldId]);
            if (!dateObj) return null;

            const groupPart = groupFieldId ? formatVal(record.fields?.[groupFieldId]) : '';
            const titlePart = formatVal(record.fields?.[titleFieldId]);
            const label = groupPart ? `[${groupPart}] ${titlePart}` : titlePart;
            const dateKey = getDateKey(dateObj);

            return {
              id: `task_${record.recordId}`,
              content: createTaskNode(label, record.recordId, dateKey),
              start: dateObj,
              className: 'lark-item'
            };
          })
          .filter(Boolean);

        const overlayTaskData = filteredRecords
          .map((record: any) => {
            const task = taskMapById.get(record.recordId);
            if (!task?.start) return null;

            const comments = (commentMap.get(record.recordId) || []).sort(
              (a, b) => b.sortTime - a.sortTime
            );
            if (!comments.length) return null;

            return {
              taskId: record.recordId,
              start: task.start as Date,
              dateKey: task.dateKey as string,
              comments
            };
          })
          .filter(Boolean) as Array<{ taskId: string; start: Date; dateKey: string; comments: CommentLine[] }>;

        setOverlayHeight(
          estimateOverlayHeight(
            overlayTaskData.map(item => ({
              comments: getVisibleComments(
                item.comments,
                expandedCommentTaskIdsRef.current.has(item.taskId)
              )
            }))
          )
        );
        setIsConfigured(true);

        setTimeout(() => {
          if (!containerRef.current || !wrapperRef.current) return;

          cleanupTimelineListeners();

          if (timelineRef.current) {
            timelineRef.current.destroy();
          }

          const timeline = new Timeline(containerRef.current, new DataSet(timelineItems as any), {
            height: '450px',
            zoomKey: 'ctrlKey',
            stack: true,
            format: {
              minorLabels: {
                minute: 'HH:mm',
                hour: 'HH:mm',
                weekday: 'ddd D',
                day: 'D日',
                month: 'YYYY年MM月',
                year: 'YYYY年'
              },
              majorLabels: {
                minute: 'YYYY年MM月DD日',
                hour: 'YYYY年MM月DD日',
                weekday: 'YYYY年MM月',
                day: 'YYYY年MM月',
                month: 'YYYY年',
                year: 'YYYY年'
              }
            }
          });

          timelineRef.current = timeline;

          const redrawDecorations = () => {
            if (!wrapperRef.current || !containerRef.current || !overlayRef.current) return;

            const wrapperRect = wrapperRef.current.getBoundingClientRect();
            const bottomPanel = containerRef.current.querySelector(
              '.vis-panel.vis-bottom'
            ) as HTMLElement | null;

            let axisAnchorTop = 0;
            if (bottomPanel) {
              const bottomPanelRect = bottomPanel.getBoundingClientRect();
              axisAnchorTop = bottomPanelRect.top - wrapperRect.top;
            } else {
              const containerRect = containerRef.current.getBoundingClientRect();
              axisAnchorTop = containerRect.bottom - wrapperRect.top - 26;
            }

            const anchors: AxisAnchor[] = Array.from(dateMap.entries()).map(([dateKey, dt]) => ({
              dateKey,
              left: getTimelineScreenX(timeline, dt),
              top: axisAnchorTop
            }));
            setAxisAnchors(anchors);

            const items = Array.from(
              containerRef.current.querySelectorAll('.vis-item.lark-item .task-node')
            ) as HTMLElement[];

            // 每条任务竖线在经过其他任务卡片时主动断开，避免连接线覆盖文字。
            // 仅靠 z-index 无法可靠处理 vis-timeline 内部的多层 stacking context。
            const labelObstacles = items
              .map(node => node.querySelector('.task-node-label')?.getBoundingClientRect())
              .filter(Boolean)
              .map(rect => ({
                left: (rect as DOMRect).left - wrapperRect.left - 5,
                right: (rect as DOMRect).right - wrapperRect.left + 5,
                top: (rect as DOMRect).top - wrapperRect.top - 5,
                bottom: (rect as DOMRect).bottom - wrapperRect.top + 5
              }));

            const decorations: TaskDecoration[] = items
              .map(node => {
                const taskId = node.getAttribute('data-task-id') || '';
                const dateKey = node.getAttribute('data-date-key') || '';
                if (!taskId || !dateKey) return null;

                const matchedAnchor = anchors.find(a => a.dateKey === dateKey);
                if (!matchedAnchor) return null;

                const nodeRect = node.getBoundingClientRect();
                const labelRect = node.querySelector('.task-node-label')?.getBoundingClientRect();
                if (!labelRect) return null;

                const left = nodeRect.left - wrapperRect.left + nodeRect.width / 2;
                const top = labelRect.bottom - wrapperRect.top + 6;
                const bottom = matchedAnchor.top;
                if (bottom <= top) return null;

                const blockingRanges = labelObstacles
                  .filter(obstacle => left >= obstacle.left && left <= obstacle.right)
                  .map(obstacle => ({
                    top: Math.max(top, obstacle.top),
                    bottom: Math.min(bottom, obstacle.bottom)
                  }))
                  .filter(range => range.bottom > range.top)
                  .sort((a, b) => a.top - b.top);

                const mergedRanges = blockingRanges.reduce<Array<{ top: number; bottom: number }>>(
                  (ranges, range) => {
                    const previous = ranges[ranges.length - 1];
                    if (previous && range.top <= previous.bottom) {
                      previous.bottom = Math.max(previous.bottom, range.bottom);
                    } else {
                      ranges.push({ ...range });
                    }
                    return ranges;
                  },
                  []
                );

                const segments: Array<{ top: number; height: number }> = [];
                let cursor = top;
                mergedRanges.forEach(range => {
                  if (range.top - cursor >= 3) {
                    segments.push({ top: cursor, height: range.top - cursor });
                  }
                  cursor = Math.max(cursor, range.bottom);
                });
                if (bottom - cursor >= 3) {
                  segments.push({ top: cursor, height: bottom - cursor });
                }

                return {
                  taskId,
                  left,
                  segments
                };
              })
              .filter(item => item?.segments.length) as TaskDecoration[];

            setTaskDecorations(decorations);

            const blocks: OverlayBlock[] = overlayTaskData.map(item => {
              const x = getTimelineScreenX(timeline, item.start);
              const left = x;

              return {
                taskId: item.taskId,
                left,
                comments: item.comments
              };
            });

            setOverlayBlocks(blocks);
            setOverlayHeight(
              estimateOverlayHeight(
                overlayTaskData.map(item => ({
                  comments: getVisibleComments(
                    item.comments,
                    expandedCommentTaskIdsRef.current.has(item.taskId)
                  )
                }))
              )
            );
          };

          timelineHandlersRef.current.redrawDecorations = redrawDecorations;
          timelineHandlersRef.current.rangechanged = () => redrawDecorations();
          timelineHandlersRef.current.changed = () => redrawDecorations();
          timelineHandlersRef.current.select = (properties: { items?: Array<string | number> }) => {
            const selectedItemId = String(properties.items?.[0] || '');
            if (selectedItemId.startsWith('task_')) {
              setFocusedCommentTaskId(selectedItemId.slice('task_'.length));
            }
          };

          timeline.on('rangechanged', timelineHandlersRef.current.rangechanged);
          timeline.on('changed', timelineHandlersRef.current.changed);
          timeline.on('select', timelineHandlersRef.current.select);

          redrawDecorations();
          if (!isConfigMode) {
            window.requestAnimationFrame(() => {
              dashboard.setRendered().catch(err => console.error('通知仪表盘渲染完成失败', err));
            });
          }
        }, 50);

        lastDataSignatureRef.current = currentSignature;
        setConfigError('');
      } catch (err) {
        console.error(err);
        setConfigError(`生成失败：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setIsRendering(false);
      }
    },
    [
      selectedTableId,
      titleFieldId,
      dateFieldId,
      groupFieldId,
      filterFieldId1,
      selectedFilterVals1,
      filterFieldId2,
      selectedFilterVals2,
      commentTableId,
      commentRelationFieldId,
      commentTextFieldId,
      commentDateFieldId,
      commentFontSize,
      commentBlockWidth,
      getAllRecords,
      buildDataSignature,
      isRendering,
      recordMatchesFilters,
      isConfigMode
    ]
  );

  const startAutoRefresh = useCallback(() => {
    if (autoRefreshTimerRef.current) {
      window.clearInterval(autoRefreshTimerRef.current);
      autoRefreshTimerRef.current = null;
    }

    if (isConfigMode || !isConfigured) return;
    if (!selectedTableId || !titleFieldId || !dateFieldId) return;

    autoRefreshTimerRef.current = window.setInterval(async () => {
      if (!isPageVisibleRef.current) return;
      await renderTimeline(false);
    }, AUTO_REFRESH_MS);
  }, [isConfigMode, isConfigured, selectedTableId, titleFieldId, dateFieldId, renderTimeline]);

  const stopAutoRefresh = useCallback(() => {
    if (autoRefreshTimerRef.current) {
      window.clearInterval(autoRefreshTimerRef.current);
      autoRefreshTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    bitable.base.getTableMetaList().then(setTables);
  }, []);

  const applyDashboardConfig = useCallback((dashboardConfig?: IConfig) => {
    const saved = dashboardConfig?.customConfig as Partial<PluginConfig> | undefined;
    if (!saved) return false;

    setSelectedTableId(saved.selectedTableId || '');
    setGroupFieldId(saved.groupFieldId || '');
    setTitleFieldId(saved.titleFieldId || '');
    setDateFieldId(saved.dateFieldId || '');

    setFilterFieldId1(saved.filterFieldId1 || '');
    setSelectedFilterVals1(saved.selectedFilterVals1 || []);

    setFilterFieldId2(saved.filterFieldId2 || '');
    setSelectedFilterVals2(saved.selectedFilterVals2 || []);

    setCommentTableId(saved.commentTableId || '');
    setCommentRelationFieldId(saved.commentRelationFieldId || '');
    setCommentTextFieldId(saved.commentTextFieldId || '');
    setCommentDateFieldId(saved.commentDateFieldId || '');
    setCommentFontSize(saved.commentFontSize ?? 13);
    setCommentBlockWidth(saved.commentBlockWidth ?? 420);
    setAppliedConfigVersion(version => version + 1);
    return true;
  }, []);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        if (dashboard.state !== DashboardState.Create) {
          applyDashboardConfig(await dashboard.getConfig());
        }
      } catch (e) {
        console.error('读取配置失败', e);
        setConfigError('读取已保存配置失败，请重新打开配置面板后再试。');
      } finally {
        setIsConfigLoaded(true);
      }
    };

    loadConfig();

    const offConfigChange = dashboard.onConfigChange(event => {
      setConfigError('');
      applyDashboardConfig(event.data);
      setIsConfigLoaded(true);
    });

    return () => offConfigChange();
  }, [applyDashboardConfig]);

  useEffect(() => {
    if (selectedTableId) {
      bitable.base
        .getTableById(selectedTableId)
        .then(t => t.getFieldMetaList().then(setFields))
        .catch(err => {
          console.error(err);
          setFields([]);
        });
    } else {
      setFields([]);
    }
  }, [selectedTableId]);

  useEffect(() => {
    if (commentTableId) {
      bitable.base
        .getTableById(commentTableId)
        .then(t => t.getFieldMetaList().then(setCommentFields))
        .catch(err => {
          console.error(err);
          setCommentFields([]);
        });
    } else {
      setCommentFields([]);
    }
  }, [commentTableId]);

  const loadFilterOptions = useCallback(
    async (
      fieldId: string,
      setOptions: React.Dispatch<React.SetStateAction<string[]>>,
      setSelected: React.Dispatch<React.SetStateAction<string[]>>
    ) => {
      if (!selectedTableId || !fieldId) {
        setOptions([]);
        setSelected([]);
        return;
      }

      try {
        const table = await bitable.base.getTableById(selectedTableId);
        const fieldMeta = await table.getFieldMetaById(fieldId);

        if (
          fieldMeta.type === FieldType.SingleSelect ||
          fieldMeta.type === FieldType.MultiSelect
        ) {
          const field = await table.getField<ISingleSelectField | IMultiSelectField>(fieldId);
          const options = await field.getOptions();
          setOptions(options.map(opt => opt.name));
        } else {
          const { records } = await getAllRecords(selectedTableId);
          const values = new Set<string>();

          records.forEach((r: any) => {
            const rawVal = r.fields?.[fieldId];
            if (Array.isArray(rawVal)) {
              rawVal.forEach(item => {
                const v =
                  typeof item === 'string' || typeof item === 'number'
                    ? String(item)
                    : item?.name || item?.text || item?.title || item?.label || item?.value || '';
                if (v) values.add(v);
              });
            } else {
              const val = formatVal(rawVal);
              if (val) {
                val
                  .split(',')
                  .map(x => x.trim())
                  .filter(Boolean)
                  .forEach(x => values.add(x));
              }
            }
          });

          setOptions(Array.from(values));
        }
      } catch (e) {
        console.error('读取筛选项失败', e);
        setOptions([]);
      }
    },
    [selectedTableId, getAllRecords]
  );

  useEffect(() => {
    loadFilterOptions(filterFieldId1, setFilterOptions1, setSelectedFilterVals1);
  }, [filterFieldId1, loadFilterOptions]);

  useEffect(() => {
    loadFilterOptions(filterFieldId2, setFilterOptions2, setSelectedFilterVals2);
  }, [filterFieldId2, loadFilterOptions]);

  useEffect(() => {
    if (filterFieldId1 && filterFieldId2 && filterFieldId1 === filterFieldId2) {
      setFilterFieldId2('');
      setFilterOptions2([]);
      setSelectedFilterVals2([]);
    }
  }, [filterFieldId1, filterFieldId2]);

  useEffect(() => {
    if (!isConfigLoaded) return;

    if (!selectedTableId || !titleFieldId || !dateFieldId) {
      if (!isConfigMode) {
        dashboard.setRendered().catch(err => console.error('通知仪表盘渲染完成失败', err));
      }
      return;
    }

    renderTimeline(true);
    // 这里只响应飞书下发的已保存配置版本；右侧尚未确认的草稿不会改动仪表盘视图。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedConfigVersion, isConfigLoaded]);

  useEffect(() => {
    if (!isConfigMode || !isConfigLoaded) return;
    if (!selectedTableId || !titleFieldId || !dateFieldId) return;

    const previewTimer = window.setTimeout(() => {
      renderTimeline(true);
    }, 250);

    return () => window.clearTimeout(previewTimer);
  }, [
    isConfigMode,
    isConfigLoaded,
    selectedTableId,
    groupFieldId,
    titleFieldId,
    dateFieldId,
    filterFieldId1,
    selectedFilterVals1,
    filterFieldId2,
    selectedFilterVals2,
    commentTableId,
    commentRelationFieldId,
    commentTextFieldId,
    commentDateFieldId,
    commentFontSize,
    commentBlockWidth
  ]);

  useEffect(() => {
    const onResize = () => {
      if (timelineRef.current && timelineHandlersRef.current.redrawDecorations) {
        timelineHandlersRef.current.redrawDecorations();
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (isConfigured && timelineHandlersRef.current.redrawDecorations) {
      timelineHandlersRef.current.redrawDecorations();
    }
  }, [commentFontSize, commentBlockWidth, isConfigured]);

  useEffect(() => {
    expandedCommentTaskIdsRef.current = expandedCommentTaskIds;
    if (!overlayBlocks.length) return;

    setOverlayHeight(
      estimateOverlayHeight(
        overlayBlocks.map(block => ({
          comments: getVisibleComments(
            block.comments,
            expandedCommentTaskIds.has(block.taskId)
          )
        }))
      )
    );
  }, [expandedCommentTaskIds, overlayBlocks, commentFontSize, commentBlockWidth]);

  useEffect(() => {
    const onVisibilityChange = () => {
      isPageVisibleRef.current = !document.hidden;
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    startAutoRefresh();
    return () => stopAutoRefresh();
  }, [startAutoRefresh, stopAutoRefresh]);

  useEffect(() => {
    return () => {
      stopAutoRefresh();
      cleanupTimelineListeners();
      if (timelineRef.current) {
        timelineRef.current.destroy();
        timelineRef.current = null;
      }
    };
  }, [stopAutoRefresh]);

  const handleSaveConfig = async () => {
    if (!selectedTableId || !titleFieldId || !dateFieldId) {
      setConfigError('请先选择数据表、任务标题和日期字段。');
      return;
    }

    const config: PluginConfig = {
      selectedTableId,
      groupFieldId,
      titleFieldId,
      dateFieldId,
      filterFieldId1,
      selectedFilterVals1,
      filterFieldId2,
      selectedFilterVals2,
      commentTableId,
      commentRelationFieldId,
      commentTextFieldId,
      commentDateFieldId,
      commentFontSize,
      commentBlockWidth
    };

    try {
      setIsSavingConfig(true);
      setConfigError('');
      const didSave = await dashboard.saveConfig({
        dataConditions: [],
        customConfig: config
      });
      if (!didSave) {
        throw new Error('飞书未接受本次配置，请确认当前多维表格允许编辑仪表盘。');
      }
    } catch (err) {
      console.error('保存配置失败', err);
      setConfigError(`保存配置失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSavingConfig(false);
    }
  };

  const toggleSelectedValue = (
    checked: boolean,
    value: string,
    setState: React.Dispatch<React.SetStateAction<string[]>>
  ) => {
    setState(prev => {
      if (checked) {
        if (prev.includes(value)) return prev;
        return [...prev, value];
      }
      return prev.filter(v => v !== value);
    });
  };

  const toggleTaskComments = (taskId: string) => {
    setExpandedCommentTaskIds(previous => {
      const next = new Set(previous);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      expandedCommentTaskIdsRef.current = next;
      return next;
    });
  };

  return (
    <div className={`app-shell ${isConfigMode ? 'config-mode' : 'view-mode'}`}>
      <style>{`
        * {
          box-sizing: border-box;
        }

        html, body, #root {
          margin: 0;
          padding: 0;
          width: 100%;
          height: 100%;
        }

        .app-shell {
          display: flex;
          width: 100%;
          min-height: 100vh;
          background: var(--bg-body, #fff);
          color: #1f2329;
          font-family: "PingFang SC","Microsoft YaHei","Helvetica Neue",Arial,sans-serif;
        }

        .app-shell.config-mode {
          border-top: 1px solid var(--divider, #e5e6eb);
        }

        .main-panel {
          flex: 1;
          min-width: 0;
          padding: 0;
        }

        .side-panel {
          width: 340px;
          flex: none;
          background: var(--bg-body, #fff);
          border-left: 1px solid var(--divider, #e5e6eb);
          display: flex;
          flex-direction: column;
          height: 100vh;
        }

        .side-body {
          padding: 20px;
          overflow-y: auto;
          flex: 1;
        }

        .config-section {
          padding: 8px 0 18px;
          border-bottom: 1px solid #f0f1f3;
          margin-bottom: 14px;
        }

        .config-section:last-child {
          border-bottom: none;
        }

        .section-title {
          font-size: 14px;
          font-weight: 600;
          color: #1f2329;
          margin-bottom: 14px;
        }

        .field-row {
          margin-bottom: 14px;
        }

        .field-label {
          display: block;
          font-size: 13px;
          color: #4e5969;
          margin-bottom: 8px;
        }

        .lark-select, .lark-input {
          width: 100%;
          height: 34px;
          border: 1px solid #d0d3d9;
          border-radius: 6px;
          padding: 0 10px;
          font-size: 13px;
          background: #fff;
          color: #1f2329;
          outline: none;
        }

        .lark-select:focus, .lark-input:focus {
          border-color: #3370ff;
          box-shadow: 0 0 0 2px rgba(51,112,255,0.12);
        }

        .range-wrap {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .range-wrap input[type="range"] {
          flex: 1;
          accent-color: #3370ff;
        }

        .range-value {
          width: 56px;
          text-align: right;
          font-size: 12px;
          color: #86909c;
        }

        .checkbox-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .checkbox-item {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          color: #1f2329;
          padding: 4px 8px;
          border-radius: 14px;
          background: #f7f8fa;
          border: 1px solid #e5e6eb;
        }

        .generate-btn {
          min-width: 80px;
          height: 36px;
          background: #3370ff;
          color: #fff;
          border: none;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
        }

        .config-actions {
          position: sticky;
          bottom: -1px;
          margin: 0 -20px -20px;
          padding: 12px 20px 20px;
          background: var(--bg-body, #fff);
          border-top: 1px solid var(--divider, #f0f1f3);
        }

        .config-actions .generate-btn {
          display: block;
          margin-left: auto;
        }

        .generate-btn:disabled {
          opacity: .6;
          cursor: not-allowed;
        }

        .config-error {
          margin: 0 0 12px;
          padding: 9px 10px;
          color: #d83931;
          background: #fef1f1;
          border: 1px solid #fde2e2;
          border-radius: 6px;
          font-size: 12px;
          line-height: 1.5;
        }

        .canvas-card {
          background: #fff;
          border: none;
          border-radius: 0;
          overflow: hidden;
          min-height: 100vh;
        }

        .canvas-toolbar {
          min-height: 54px;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          padding: 12px 18px;
          border-bottom: 1px solid #f0f1f3;
          background: #fff;
          gap: 16px;
        }

        .canvas-title {
          font-size: 18px;
          font-weight: 600;
          color: #1f2329;
        }

        .toolbar-status {
          font-size: 12px;
          color: #86909c;
          white-space: nowrap;
          padding-top: 4px;
        }

        .filter-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 10px;
        }

        .filter-badge {
          font-size: 12px;
          color: #3370ff;
          background: #edf3ff;
          border: 1px solid #d6e4ff;
          padding: 4px 8px;
          border-radius: 999px;
        }

        .timeline-stage {
          padding: 12px;
          background: #fff;
          min-height: 100vh;
        }

        .empty-state {
          min-height: 420px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          color: #86909c;
          padding: 40px;
        }

        .empty-state-icon {
          width: 44px;
          height: 44px;
          display: grid;
          place-items: center;
          margin-bottom: 14px;
          border-radius: 12px;
          color: #3370ff;
          background: #edf3ff;
          font-size: 22px;
        }

        .empty-state-title {
          color: #1f2329;
          font-size: 15px;
          font-weight: 600;
          margin-bottom: 6px;
        }

        .empty-state-description {
          max-width: 360px;
          font-size: 13px;
          line-height: 1.6;
        }

        .timeline-wrapper {
          position: relative;
          width: 100%;
          border: 1px solid #e5e6eb;
          border-radius: 10px;
          overflow: hidden;
          background: #fff;
        }

        .task-decoration-layer {
          position: absolute;
          inset: 0;
          pointer-events: none;
          overflow: visible;
          z-index: 1;
        }

        .task-decoration-line {
          position: absolute;
          width: 1px;
          background: rgba(51,112,255,0.72);
          border-radius: 999px;
          transform: translateX(-50%);
        }

        .axis-anchor-layer {
          position: absolute;
          inset: 0;
          pointer-events: none;
          overflow: visible;
          z-index: 2;
        }

        .axis-anchor-dot {
          position: absolute;
          width: 9px;
          height: 9px;
          background: #3370ff;
          border-radius: 50%;
          box-shadow: 0 0 0 2px #ffffff;
          transform: translate(-50%, -50%);
        }

        .timeline-overlay {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          pointer-events: none;
          overflow: visible;
          z-index: 20;
        }

        .axis-comment-block {
          position: absolute;
          top: 12px;
          transform: translateX(-50%);
          color: #1f2329;
          text-align: left;
          white-space: normal;
          word-break: break-word;
          overflow-wrap: anywhere;
          z-index: 1;
        }

        .axis-comment-block::before {
          content: '';
          position: absolute;
          top: -18px;
          left: 50%;
          transform: translateX(-50%);
          width: 4px;
          height: 14px;
          background: #3370ff;
          border-radius: 999px;
          box-shadow: 0 0 0 2px rgba(51,112,255,0.08);
        }

        .axis-comment-card {
          position: relative;
          background: #ffffff;
          border: 1px solid #e5e6eb;
          border-radius: 12px;
          box-shadow: 0 4px 14px rgba(31,35,41,0.06);
          padding: 10px 12px;
          cursor: pointer;
          pointer-events: auto;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }

        .axis-comment-block.is-focused .axis-comment-card {
          border-color: #81a9ff;
          box-shadow: 0 8px 24px rgba(51,112,255,0.18);
        }

        .axis-comment-date-group {
          display: grid;
          grid-template-columns: 82px minmax(0, 1fr);
          gap: 10px;
          padding: 8px 0;
          border-bottom: 1px solid #f0f1f3;
        }

        .axis-comment-date-group:first-child {
          padding-top: 0;
        }

        .axis-comment-date-group:last-of-type {
          border-bottom: none;
        }

        .axis-comment-date {
          color: #3370ff;
          font-weight: 600;
          white-space: nowrap;
        }

        .axis-comment-text {
          color: #1f2329;
          white-space: pre-line;
          word-break: break-word;
          overflow-wrap: anywhere;
        }

        .axis-comment-text + .axis-comment-text {
          margin-top: 6px;
        }

        .comment-toggle {
          display: block;
          margin: 8px auto 0;
          padding: 4px 8px;
          color: #3370ff;
          background: transparent;
          border: none;
          border-radius: 4px;
          font-size: 12px;
          cursor: pointer;
          pointer-events: auto;
        }

        .comment-toggle:hover {
          background: #edf3ff;
        }

        .vis-timeline {
          border: none !important;
          background: #fff !important;
        }

        .vis-panel.vis-center,
        .vis-panel.vis-left,
        .vis-panel.vis-right,
        .vis-panel.vis-top,
        .vis-panel.vis-bottom {
          border-color: #f0f1f3 !important;
        }

        .vis-time-axis .vis-text {
          color: #646a73;
          font-size: 12px;
        }

        .vis-time-axis .vis-grid.vis-minor {
          border-color: #f3f4f6;
        }

        .vis-time-axis .vis-grid.vis-major {
          border-color: #eaedf2;
        }

        .vis-labelset .vis-label {
          border-bottom: 1px solid #f5f6f7 !important;
        }

        .vis-itemset .vis-background,
        .vis-itemset .vis-foreground {
          background: #fff !important;
        }

        .vis-item.lark-item {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          padding: 0 !important;
          overflow: visible !important;
          z-index: 30 !important;
        }

        .vis-item.lark-item .vis-item-overflow {
          overflow: visible !important;
        }

        .vis-item.lark-item .vis-item-content {
          padding: 0 !important;
          overflow: visible !important;
        }

        .task-node {
          position: relative;
          display: inline-flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          transform: translateY(-6px);
          overflow: visible;
          z-index: 10;
        }

        .task-node-label {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 6px 10px;
          border: 1px solid #81a9ff;
          background: #eef4ff;
          color: #5b7fe8;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 600;
          line-height: 1;
          white-space: nowrap;
          position: relative;
          z-index: 50;
          isolation: isolate;
          box-shadow: 0 0 0 3px #ffffff;
        }

        .vis-item.vis-selected.lark-item .task-node-label,
        .vis-item.lark-item:hover .task-node-label {
          background: #e8f0ff;
          border-color: #6f98ff;
          color: #4c72df;
        }

        .sub-tip {
          font-size: 12px;
          color: #86909c;
          margin-top: 4px;
          line-height: 1.6;
        }
      `}</style>

      <div className="main-panel">
        <div className="canvas-card">
          <div className="timeline-stage">
            {isConfigured ? (
              <div
                ref={wrapperRef}
                className="timeline-wrapper"
                style={{ paddingBottom: `${overlayHeight}px` }}
              >
                <div ref={containerRef} />

                <div className="task-decoration-layer">
                  {taskDecorations.map(item => (
                    <React.Fragment key={item.taskId}>
                      {item.segments.map((segment, segmentIndex) => (
                        <div
                          key={`${item.taskId}_${segmentIndex}`}
                          className="task-decoration-line"
                          style={{
                            left: `${item.left}px`,
                            top: `${segment.top}px`,
                            height: `${segment.height}px`
                          }}
                        />
                      ))}
                    </React.Fragment>
                  ))}
                </div>

                <div className="axis-anchor-layer">
                  {axisAnchors.map(anchor => (
                    <div
                      key={anchor.dateKey}
                      className="axis-anchor-dot"
                      style={{
                        left: `${anchor.left}px`,
                        top: `${anchor.top}px`
                      }}
                    />
                  ))}
                </div>

                <div
                  ref={overlayRef}
                  className="timeline-overlay"
                  style={{ height: `${overlayHeight}px` }}
                >
                  {overlayBlocks.map(block => {
                    const allDateGroups = groupCommentsByDate(block.comments);
                    const isExpanded = expandedCommentTaskIds.has(block.taskId);
                    const isFocused = focusedCommentTaskId === block.taskId;
                    const visibleDateGroups = isExpanded
                      ? allDateGroups
                      : allDateGroups.slice(0, 3);

                    return (
                      <div
                        key={block.taskId}
                        className={`axis-comment-block${isFocused ? ' is-focused' : ''}`}
                        style={{
                          left: `${block.left}px`,
                          width: `${commentBlockWidth}px`,
                          fontSize: `${commentFontSize}px`,
                          lineHeight: `${Math.round(commentFontSize * 1.55)}px`,
                          zIndex: isFocused ? 1000 : 1
                        }}
                      >
                        <div
                          className="axis-comment-card"
                          title="点击将此任务评论置于最上层"
                          onPointerDown={() => setFocusedCommentTaskId(block.taskId)}
                        >
                          {visibleDateGroups.map(group => (
                            <div key={group.dateText} className="axis-comment-date-group">
                              <div className="axis-comment-date">{group.dateText}</div>
                              <div>
                                {group.comments.map((comment, commentIndex) => (
                                  <div
                                    key={`${comment.sortTime}_${commentIndex}`}
                                    className="axis-comment-text"
                                  >
                                    {comment.commentText}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}

                          {allDateGroups.length > 3 && (
                            <button
                              type="button"
                              className="comment-toggle"
                              aria-expanded={isExpanded}
                              onClick={event => {
                                event.stopPropagation();
                                toggleTaskComments(block.taskId);
                              }}
                            >
                              {isExpanded
                                ? '收起评论'
                                : `展开全部（共 ${allDateGroups.length} 个日期）`}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-state-icon">⌁</div>
                <div className="empty-state-title">
                  {!isConfigLoaded ? '正在读取配置' : configError ? '暂时无法生成进程图' : '还没有进程图'}
                </div>
                <div className="empty-state-description">
                  {!isConfigLoaded
                    ? '正在从仪表盘加载已保存的组件配置…'
                    : configError
                    ? configError
                    : isConfigMode
                    ? '请在右侧选择数据表、任务标题和日期字段，左侧会实时预览。'
                    : '请点击组件右上角的“···”，选择“配置”完成设置。'}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {isConfigMode && <div className="side-panel">
        <div className="side-body">
          <div className="config-section">
            <div className="section-title">数据</div>

            <div className="field-row">
              <label className="field-label">来源</label>
              <select
                className="lark-select"
                value={selectedTableId}
                onChange={e => {
                  setSelectedTableId(e.target.value);
                  setGroupFieldId('');
                  setTitleFieldId('');
                  setDateFieldId('');
                  setFilterFieldId1('');
                  setSelectedFilterVals1([]);
                  setFilterFieldId2('');
                  setSelectedFilterVals2([]);
                  setIsConfigured(false);
                }}
              >
                <option value="">请选择表格</option>
                {tables.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field-row">
              <label className="field-label">任务标题</label>
              <select
                className="lark-select"
                value={titleFieldId}
                onChange={e => setTitleFieldId(e.target.value)}
              >
                <option value="">请选择</option>
                {fields.map(f => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field-row">
              <label className="field-label">开始\结束日期</label>
              <select
                className="lark-select"
                value={dateFieldId}
                onChange={e => setDateFieldId(e.target.value)}
              >
                <option value="">请选择</option>
                {fields
                  .filter(f => f.type === FieldType.DateTime)
                  .map(f => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
              </select>
            </div>

            <div className="field-row">
              <label className="field-label">分组前缀（可选）</label>
              <select
                className="lark-select"
                value={groupFieldId}
                onChange={e => setGroupFieldId(e.target.value)}
              >
                <option value="">无</option>
                {fields.map(f => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="config-section">
            <div className="section-title">筛选条件 1</div>

            <div className="field-row">
              <label className="field-label">筛选字段</label>
              <select
                className="lark-select"
                value={filterFieldId1}
                onChange={e => {
                  setFilterFieldId1(e.target.value);
                  setSelectedFilterVals1([]);
                }}
              >
                <option value="">不使用筛选</option>
                {fields.map(f => (
                  <option
                    key={f.id}
                    value={f.id}
                    disabled={filterFieldId2 === f.id}
                  >
                    {f.name}
                  </option>
                ))}
              </select>
            </div>

            {filterOptions1.length > 0 && (
              <div className="field-row">
                <label className="field-label">可见记录</label>
                <div className="checkbox-grid">
                  {filterOptions1.map(opt => (
                    <label key={opt} className="checkbox-item">
                      <input
                        type="checkbox"
                        checked={selectedFilterVals1.includes(opt)}
                        onChange={e => toggleSelectedValue(e.target.checked, opt, setSelectedFilterVals1)}
                      />
                      {opt}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="config-section">
            <div className="section-title">筛选条件 2</div>

            <div className="field-row">
              <label className="field-label">筛选字段</label>
              <select
                className="lark-select"
                value={filterFieldId2}
                onChange={e => {
                  setFilterFieldId2(e.target.value);
                  setSelectedFilterVals2([]);
                }}
              >
                <option value="">不使用筛选</option>
                {fields.map(f => (
                  <option
                    key={f.id}
                    value={f.id}
                    disabled={filterFieldId1 === f.id}
                  >
                    {f.name}
                  </option>
                ))}
              </select>
            </div>

            {filterOptions2.length > 0 && (
              <div className="field-row">
                <label className="field-label">可见记录</label>
                <div className="checkbox-grid">
                  {filterOptions2.map(opt => (
                    <label key={opt} className="checkbox-item">
                      <input
                        type="checkbox"
                        checked={selectedFilterVals2.includes(opt)}
                        onChange={e => toggleSelectedValue(e.target.checked, opt, setSelectedFilterVals2)}
                      />
                      {opt}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="sub-tip">
              同一条件内多选为“或”；两个条件之间为“且”。
            </div>
          </div>

          <div className="config-section">
            <div className="section-title">评论配置</div>

            <div className="field-row">
              <label className="field-label">评论子表</label>
              <select
                className="lark-select"
                value={commentTableId}
                onChange={e => {
                  setCommentTableId(e.target.value);
                  setCommentRelationFieldId('');
                  setCommentTextFieldId('');
                  setCommentDateFieldId('');
                }}
              >
                <option value="">不使用评论子表</option>
                {tables.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field-row">
              <label className="field-label">评论关联任务字段</label>
              <select
                className="lark-select"
                value={commentRelationFieldId}
                onChange={e => setCommentRelationFieldId(e.target.value)}
              >
                <option value="">请选择</option>
                {commentFields.map(f => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field-row">
              <label className="field-label">评论内容字段</label>
              <select
                className="lark-select"
                value={commentTextFieldId}
                onChange={e => setCommentTextFieldId(e.target.value)}
              >
                <option value="">请选择</option>
                {commentFields.map(f => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field-row">
              <label className="field-label">评论时间字段</label>
              <select
                className="lark-select"
                value={commentDateFieldId}
                onChange={e => setCommentDateFieldId(e.target.value)}
              >
                <option value="">请选择</option>
                {commentFields
                  .filter(f => f.type === FieldType.DateTime)
                  .map(f => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div className="config-section">
            <div className="section-title">自定义配置</div>

            <div className="field-row">
              <label className="field-label">评论字体大小</label>
              <div className="range-wrap">
                <input
                  type="range"
                  min={10}
                  max={20}
                  step={1}
                  value={commentFontSize}
                  onChange={e => setCommentFontSize(Number(e.target.value))}
                />
                <span className="range-value">{commentFontSize}px</span>
              </div>
            </div>

            <div className="field-row">
              <label className="field-label">评论块宽度</label>
              <div className="range-wrap">
                <input
                  type="range"
                  min={260}
                  max={560}
                  step={10}
                  value={commentBlockWidth}
                  onChange={e => setCommentBlockWidth(Number(e.target.value))}
                />
                <span className="range-value">{commentBlockWidth}px</span>
              </div>
            </div>

            <div className="sub-tip"></div>
          </div>

          <div className="config-actions">
            {configError && <div className="config-error">{configError}</div>}

            <button
              className="generate-btn"
              onClick={handleSaveConfig}
              disabled={!selectedTableId || !titleFieldId || !dateFieldId || isSavingConfig}
            >
              {isSavingConfig ? '保存中…' : '确定'}
            </button>
          </div>
        </div>
      </div>}
    </div>
  );
}

export default App;
