import json
import os
import sys

panel_counter = 1

def next_id():
    global panel_counter
    res = panel_counter
    panel_counter += 1
    return res

panels = []
current_y = 0

def target(ref_id, query_text, root_selector, columns):
    return {
        "columns": columns,
        "datasource": {
            "type": "yesoreyeram-infinity-datasource",
            "uid": "${DS_CLOUDFLARE_GRAPHQL_DATA_SOURCE}"
        },
        "format": "table",
        "parser": "backend",
        "queryType": "graphql",
        "refId": ref_id,
        "root_selector": root_selector,
        "source": "url",
        "type": "graphql",
        "url": "https://api.cloudflare.com/client/v4/graphql",
        "url_options": {
            "data": query_text,
            "headers": [
                { "key": "X-AUTH-EMAIL", "value": "${accountEmail}" },
                { "key": "X-AUTH-KEY", "value": "${apiKey}" }
            ],
            "method": "POST"
        }
    }

def add_row(title, collapsed=False):
    global current_y, panels
    p = {
        "collapsed": collapsed,
        "gridPos": { "h": 1, "w": 24, "x": 0, "y": current_y },
        "id": next_id(),
        "panels": [],
        "title": title,
        "type": "row"
    }
    panels.append(p)
    current_y += 1

def stat_panel(title, description, grid_pos, unit, targets, reduce_calc="lastNotNull", color_mode="value", thresholds=None):
    if thresholds is None:
        thresholds = {
            "mode": "absolute",
            "steps": [
                { "color": "green", "value": None },
                { "color": "yellow", "value": 70 },
                { "color": "red", "value": 90 }
            ]
        }
    return {
        "id": next_id(),
        "title": title,
        "description": description,
        "type": "stat",
        "gridPos": grid_pos,
        "datasource": {
            "type": "yesoreyeram-infinity-datasource",
            "uid": "${DS_CLOUDFLARE_GRAPHQL_DATA_SOURCE}"
        },
        "targets": targets,
        "options": {
            "colorMode": color_mode,
            "graphMode": "area",
            "justifyMode": "auto",
            "orientation": "auto",
            "reduceOptions": {
                "calcs": [reduce_calc],
                "fields": "",
                "values": False
            },
            "textMode": "auto"
        },
        "fieldConfig": {
            "defaults": {
                "mappings": [],
                "thresholds": thresholds,
                "unit": unit
            },
            "overrides": []
        }
    }

def bargauge_panel(title, description, grid_pos, unit, max_val, targets, reduce_calc="lastNotNull"):
    t_yellow = max_val * 0.75 if max_val else 75
    t_red = max_val if max_val else 100
    return {
        "id": next_id(),
        "title": title,
        "description": description,
        "type": "bargauge",
        "gridPos": grid_pos,
        "datasource": {
            "type": "yesoreyeram-infinity-datasource",
            "uid": "${DS_CLOUDFLARE_GRAPHQL_DATA_SOURCE}"
        },
        "targets": targets,
        "options": {
            "displayMode": "gradient",
            "orientation": "horizontal",
            "reduceOptions": {
                "calcs": [reduce_calc],
                "fields": "",
                "values": False
            },
            "showUnfilled": True
        },
        "fieldConfig": {
            "defaults": {
                "max": max_val,
                "min": 0,
                "thresholds": {
                    "mode": "absolute",
                    "steps": [
                        { "color": "green", "value": None },
                        { "color": "yellow", "value": t_yellow },
                        { "color": "red", "value": t_red }
                    ]
                },
                "unit": unit
            },
            "overrides": []
        }
    }
def barchart_panel(title, description, grid_pos, unit, x_field, targets, limit_val=None, group_field=None):
    defaults = {
        "custom": {
            "axisBorderShow": False,
            "axisCenteredZero": False,
            "axisColorMode": "text",
            "axisLabel": "",
            "axisPlacement": "auto",
            "fillOpacity": 80,
            "gradientMode": "none",
            "hideFrom": { "legend": False, "tooltip": False, "viz": False },
            "lineWidth": 1,
            "scaleDistribution": { "type": "linear" },
            "thresholdsStyle": { "mode": "line" }
        },
        "unit": unit
    }
    if limit_val is not None:
        defaults["thresholds"] = {
            "mode": "absolute",
            "steps": [
                { "color": "green", "value": None },
                { "color": "red", "value": limit_val }
            ]
        }
    transformations = []
    p = {
        "id": next_id(),
        "title": title,
        "description": description,
        "type": "barchart",
        "gridPos": grid_pos,
        "datasource": {
            "type": "yesoreyeram-infinity-datasource",
            "uid": "${DS_CLOUDFLARE_GRAPHQL_DATA_SOURCE}"
        },
        "targets": targets,
        "options": {
            "barRadius": 0.1,
            "barWidth": 0.7,
            "groupWidth": 0.7,
            "legend": { "calcs": [], "displayMode": "list", "placement": "top" },
            "orientation": "vertical",
            "showValue": "never",
            "stacking": "normal",
            "tooltip": { "mode": "multi", "sort": "desc" },
            "xField": x_field
        },
        "fieldConfig": {
            "defaults": defaults,
            "overrides": []
        }
    }
    if transformations:
        p["transformations"] = transformations
    return p

def timeseries_panel(title, description, grid_pos, unit, targets, limit_val=None, partition_field=None):
    defaults = {
        "custom": {
            "axisBorderShow": False,
            "axisCenteredZero": False,
            "axisColorMode": "text",
            "axisLabel": "",
            "axisPlacement": "auto",
            "fillOpacity": 15,
            "gradientMode": "opacity",
            "hideFrom": { "legend": False, "tooltip": False, "viz": False },
            "lineInterpolation": "smooth",
            "lineWidth": 2,
            "scaleDistribution": { "type": "linear" },
            "showPoints": "auto",
            "spanNulls": False,
            "stacking": { "group": "A", "mode": "none" },
            "thresholdsStyle": { "mode": "line" }
        },
        "unit": unit
    }
    if limit_val is not None:
        defaults["thresholds"] = {
            "mode": "absolute",
            "steps": [
                { "color": "green", "value": None },
                { "color": "red", "value": limit_val }
            ]
        }
    transformations = []
    if partition_field:
        transformations.append({
            "id": "partitionByValues",
            "options": { "fields": [partition_field] }
        })
    p = {
        "id": next_id(),
        "title": title,
        "description": description,
        "type": "timeseries",
        "gridPos": grid_pos,
        "datasource": {
            "type": "yesoreyeram-infinity-datasource",
            "uid": "${DS_CLOUDFLARE_GRAPHQL_DATA_SOURCE}"
        },
        "targets": targets,
        "options": {
            "legend": {
                "calcs": ["sum", "max", "lastNotNull"],
                "displayMode": "table",
                "placement": "bottom",
                "showLegend": True
            },
            "tooltip": { "mode": "multi", "sort": "desc" }
        },
        "fieldConfig": {
            "defaults": defaults,
            "overrides": []
        }
    }
    if transformations:
        p["transformations"] = transformations
    return p

def add_metric_four_pack(cfg):
    global current_y, panels
    y = current_y
    stat_p = stat_panel(
        title=cfg['stat_title'],
        description=cfg['description'],
        grid_pos={ "x": 0, "y": y, "w": 3, "h": 8 },
        unit=cfg['unit'],
        targets=[target('A', cfg['total_query'], cfg['total_root'], cfg['total_cols'])],
        reduce_calc=cfg.get('stat_calc', 'lastNotNull')
    )
    gauge_targets = [target('A', cfg.get('gauge_query', cfg['total_query']), cfg.get('gauge_root', cfg['total_root']), cfg.get('gauge_cols', cfg['total_cols']))]
    gauge_p = bargauge_panel(
        title=cfg['gauge_title'],
        description=cfg['description'] + f" (Limit: {cfg.get('limit_label', str(cfg['limit']))})",
        grid_pos={ "x": 3, "y": y, "w": 3, "h": 8 },
        unit=cfg['unit'],
        max_val=cfg['limit'],
        targets=gauge_targets,
        reduce_calc=cfg.get('gauge_calc', 'lastNotNull')
    )
    bar_p = barchart_panel(
        title=cfg['bar_title'],
        description=cfg['description'] + ' (Daily Breakdown)',
        grid_pos={ "x": 6, "y": y, "w": 7, "h": 8 },
        unit=cfg['unit'],
        x_field=cfg['x_field'],
        targets=[target('A', cfg['breakdown_query'], cfg['breakdown_root'], cfg['breakdown_cols'])],
        limit_val=cfg.get('bar_limit', cfg['limit']),
        group_field=cfg.get('partition_field')
    )
    time_p = timeseries_panel(
        title=cfg['time_title'],
        description=cfg['description'] + ' (Hourly Over Time)',
        grid_pos={ "x": 13, "y": y, "w": 11, "h": 8 },
        unit=cfg['unit'],
        targets=[target('A', cfg['timeseries_query'], cfg['timeseries_root'], cfg['timeseries_cols'])],
        limit_val=cfg.get('time_limit', cfg['limit']),
        partition_field=cfg.get('partition_field')
    )
    panels.extend([stat_p, gauge_p, bar_p, time_p])
    current_y += 8

# ==========================================
# ROW 1: Cloudflare R2 Object Storage
# ==========================================
add_row("📦 Cloudflare R2 Object Storage (ストレージ容量・Class A・Class B 操作)")

# R2 Storage Size (Limit: 10 GB = 10,737,418,240 bytes)
add_metric_four_pack({
    "stat_title": "R2 - Account Storage Usage",
    "gauge_title": "R2 - Storage vs Free Limit (10 GB)",
    "bar_title": "R2 - Storage Breakdown by Bucket",
    "time_title": "R2 - Bucket Storage Size Over Time",
    "description": "R2 Total Storage Size (Free tier: 10 GB/month included)",
    "unit": "bytes",
    "limit": 10737418240,
    "limit_label": "10 GB Free",
    "total_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { storage: r2StorageAdaptiveGroups(orderBy: [datetime_DESC], limit: 1, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}"}) { dimensions { date } max { payloadSize } } } } }',
    "total_root": "data.viewer.accounts[0].storage",
    "total_cols": [{ "selector": "max.payloadSize", "text": "Storage Size", "type": "number" }],
    "breakdown_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { storage: r2StorageAdaptiveGroups(orderBy: [bucketName_ASC], limit: 1000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}"}) { dimensions { bucketName date } max { payloadSize } } } } }',
    "breakdown_root": "data.viewer.accounts[0].storage",
    "breakdown_cols": [{ "selector": "dimensions.date", "text": "Date", "type": "string" }, { "selector": "dimensions.bucketName", "text": "Bucket", "type": "string" }, { "selector": "max.payloadSize", "text": "Storage", "type": "number" }],
    "x_field": "Date",
    "partition_field": "Bucket",
    "timeseries_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { storage: r2StorageAdaptiveGroups(orderBy: [datetimeHour_ASC], limit: 10000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}"}) { dimensions { bucketName time: datetimeHour } max { payloadSize } } } } }',
    "timeseries_root": "data.viewer.accounts[0].storage",
    "timeseries_cols": [{ "selector": "dimensions.time", "text": "Time", "type": "timestamp" }, { "selector": "dimensions.bucketName", "text": "Bucket", "type": "string" }, { "selector": "max.payloadSize", "text": "Storage", "type": "number" }]
})

# R2 Class A Operations (Limit: 1,000,000 / month)
add_metric_four_pack({
    "stat_title": "R2 - Total Class A Operations",
    "gauge_title": "R2 - Class A vs Monthly Limit (1M)",
    "bar_title": "R2 - Daily Class A Ops by Bucket",
    "time_title": "R2 - Class A Operations Over Time",
    "description": "R2 Class A Ops: PutBucket, PutObject, ListObjects, Multipart Uploads (Free tier: 1M/mo)",
    "unit": "short",
    "limit": 1000000,
    "limit_label": "1,000,000 / mo",
    "total_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { classA: r2OperationsAdaptiveGroups(limit: 1000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}", actionStatus: "success", actionType_in: ["ListBuckets", "PutBucket", "ListObjects", "PutObject", "CopyObject", "CompleteMultipartUpload", "CreateMultipartUpload", "UploadPart", "UploadPartCopy", "PutBucketEncryption", "ListMultipartUploads"]}) { sum { requests } } } } }',
    "total_root": "data.viewer.accounts[0].classA",
    "total_cols": [{ "selector": "sum.requests", "text": "Total Class A", "type": "number" }],
    "stat_calc": "sum",
    "gauge_calc": "sum",
    "breakdown_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { classA: r2OperationsAdaptiveGroups(limit: 10000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}", actionStatus: "success", actionType_in: ["ListBuckets", "PutBucket", "ListObjects", "PutObject", "CopyObject", "CompleteMultipartUpload", "CreateMultipartUpload", "UploadPart", "UploadPartCopy", "PutBucketEncryption", "ListMultipartUploads"]}) { dimensions { bucketName date } sum { requests } } } } }',
    "breakdown_root": "data.viewer.accounts[0].classA",
    "breakdown_cols": [{ "selector": "dimensions.date", "text": "Date", "type": "string" }, { "selector": "dimensions.bucketName", "text": "Bucket", "type": "string" }, { "selector": "sum.requests", "text": "Requests", "type": "number" }],
    "x_field": "Date",
    "partition_field": "Bucket",
    "timeseries_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { classA: r2OperationsAdaptiveGroups(orderBy: [datetimeHour_ASC], limit: 10000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}", actionStatus: "success", actionType_in: ["ListBuckets", "PutBucket", "ListObjects", "PutObject", "CopyObject", "CompleteMultipartUpload", "CreateMultipartUpload", "UploadPart", "UploadPartCopy", "PutBucketEncryption", "ListMultipartUploads"]}) { dimensions { actionType time: datetimeHour } sum { requests } } } } }',
    "timeseries_root": "data.viewer.accounts[0].classA",
    "timeseries_cols": [{ "selector": "dimensions.time", "text": "Time", "type": "timestamp" }, { "selector": "dimensions.actionType", "text": "Action", "type": "string" }, { "selector": "sum.requests", "text": "Requests", "type": "number" }],
    "partition_field": "Action"
})

# R2 Class B Operations (Limit: 10,000,000 / month)
add_metric_four_pack({
    "stat_title": "R2 - Total Class B Operations",
    "gauge_title": "R2 - Class B vs Monthly Limit (10M)",
    "bar_title": "R2 - Daily Class B Ops by Bucket",
    "time_title": "R2 - Class B Operations Over Time",
    "description": "R2 Class B Ops: GetObject, HeadObject, HeadBucket (Free tier: 10M/mo)",
    "unit": "short",
    "limit": 10000000,
    "limit_label": "10,000,000 / mo",
    "total_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { classB: r2OperationsAdaptiveGroups(limit: 1000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}", actionStatus: "success", actionType_in: ["HeadBucket", "HeadObject", "GetObject", "ReportUsageSummary", "GetBucketEncryption", "GetBucketLocation"]}) { sum { requests } } } } }',
    "total_root": "data.viewer.accounts[0].classB",
    "total_cols": [{ "selector": "sum.requests", "text": "Total Class B", "type": "number" }],
    "stat_calc": "sum",
    "gauge_calc": "sum",
    "breakdown_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { classB: r2OperationsAdaptiveGroups(limit: 10000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}", actionStatus: "success", actionType_in: ["HeadBucket", "HeadObject", "GetObject", "ReportUsageSummary", "GetBucketEncryption", "GetBucketLocation"]}) { dimensions { bucketName date } sum { requests } } } } }',
    "breakdown_root": "data.viewer.accounts[0].classB",
    "breakdown_cols": [{ "selector": "dimensions.date", "text": "Date", "type": "string" }, { "selector": "dimensions.bucketName", "text": "Bucket", "type": "string" }, { "selector": "sum.requests", "text": "Requests", "type": "number" }],
    "x_field": "Date",
    "partition_field": "Bucket",
    "timeseries_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { classB: r2OperationsAdaptiveGroups(orderBy: [datetimeHour_ASC], limit: 10000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}", actionStatus: "success", actionType_in: ["HeadBucket", "HeadObject", "GetObject", "ReportUsageSummary", "GetBucketEncryption", "GetBucketLocation"]}) { dimensions { actionType time: datetimeHour } sum { requests } } } } }',
    "timeseries_root": "data.viewer.accounts[0].classB",
    "timeseries_cols": [{ "selector": "dimensions.time", "text": "Time", "type": "timestamp" }, { "selector": "dimensions.actionType", "text": "Action", "type": "string" }, { "selector": "sum.requests", "text": "Requests", "type": "number" }],
    "partition_field": "Action"
})

# ==========================================
# ROW 2: Cloudflare D1 SQL Database
# ==========================================
add_row("🗄️ Cloudflare D1 SQL Database (行読み込み・行書き込み・ストレージ・クエリ)")

# D1 Rows Read (Limit: 5,000,000 / day)
add_metric_four_pack({
    "stat_title": "D1 - Total Rows Read",
    "gauge_title": "D1 - Rows Read vs Daily Limit (5M/day)",
    "bar_title": "D1 - Daily Rows Read by Database",
    "time_title": "D1 - Rows Read Over Time",
    "description": "D1 Database scanned rows (Free tier: 5M rows/day included)",
    "unit": "short",
    "limit": 5000000,
    "limit_label": "5M / day",
    "total_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { d1: d1AnalyticsAdaptiveGroups(limit: 1000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}"}) { sum { rowsRead } } } } }',
    "total_root": "data.viewer.accounts[0].d1",
    "total_cols": [{ "selector": "sum.rowsRead", "text": "Total Rows Read", "type": "number" }],
    "stat_calc": "sum",
    "gauge_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { d1: d1AnalyticsAdaptiveGroups(limit: 1, orderBy: [date_DESC], filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}"}) { dimensions { date } sum { rowsRead } } } } }',
    "gauge_root": "data.viewer.accounts[0].d1",
    "gauge_cols": [{ "selector": "sum.rowsRead", "text": "Today Rows Read", "type": "number" }],
    "breakdown_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { d1: d1AnalyticsAdaptiveGroups(limit: 10000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}"}) { dimensions { databaseId date } sum { rowsRead } } } } }',
    "breakdown_root": "data.viewer.accounts[0].d1",
    "breakdown_cols": [{ "selector": "dimensions.date", "text": "Date", "type": "string" }, { "selector": "dimensions.databaseId", "text": "Database", "type": "string" }, { "selector": "sum.rowsRead", "text": "Rows Read", "type": "number" }],
    "x_field": "Date",
    "partition_field": "Database",
    "bar_limit": 5000000,
    "timeseries_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { d1: d1AnalyticsAdaptiveGroups(orderBy: [datetimeHour_ASC], limit: 10000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}"}) { dimensions { databaseId time: datetimeHour } sum { rowsRead } } } } }',
    "timeseries_root": "data.viewer.accounts[0].d1",
    "timeseries_cols": [{ "selector": "dimensions.time", "text": "Time", "type": "timestamp" }, { "selector": "dimensions.databaseId", "text": "Database", "type": "string" }, { "selector": "sum.rowsRead", "text": "Rows Read", "type": "number" }],
    "time_limit": 5000000
})

# D1 Rows Written (Limit: 100,000 / day)
add_metric_four_pack({
    "stat_title": "D1 - Total Rows Written",
    "gauge_title": "D1 - Rows Written vs Daily Limit (100k/day)",
    "bar_title": "D1 - Daily Rows Written by Database",
    "time_title": "D1 - Rows Written Over Time",
    "description": "D1 Database written rows (Free tier: 100k rows/day included)",
    "unit": "short",
    "limit": 100000,
    "limit_label": "100k / day",
    "total_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { d1: d1AnalyticsAdaptiveGroups(limit: 1000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}"}) { sum { rowsWritten } } } } }',
    "total_root": "data.viewer.accounts[0].d1",
    "total_cols": [{ "selector": "sum.rowsWritten", "text": "Total Rows Written", "type": "number" }],
    "stat_calc": "sum",
    "gauge_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { d1: d1AnalyticsAdaptiveGroups(limit: 1, orderBy: [date_DESC], filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}"}) { dimensions { date } sum { rowsWritten } } } } }',
    "gauge_root": "data.viewer.accounts[0].d1",
    "gauge_cols": [{ "selector": "sum.rowsWritten", "text": "Today Rows Written", "type": "number" }],
    "breakdown_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { d1: d1AnalyticsAdaptiveGroups(limit: 10000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}"}) { dimensions { databaseId date } sum { rowsWritten } } } } }',
    "breakdown_root": "data.viewer.accounts[0].d1",
    "breakdown_cols": [{ "selector": "dimensions.date", "text": "Date", "type": "string" }, { "selector": "dimensions.databaseId", "text": "Database", "type": "string" }, { "selector": "sum.rowsWritten", "text": "Rows Written", "type": "number" }],
    "x_field": "Date",
    "partition_field": "Database",
    "bar_limit": 100000,
    "timeseries_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { d1: d1AnalyticsAdaptiveGroups(orderBy: [datetimeHour_ASC], limit: 10000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}"}) { dimensions { databaseId time: datetimeHour } sum { rowsWritten } } } } }',
    "timeseries_root": "data.viewer.accounts[0].d1",
    "timeseries_cols": [{ "selector": "dimensions.time", "text": "Time", "type": "timestamp" }, { "selector": "dimensions.databaseId", "text": "Database", "type": "string" }, { "selector": "sum.rowsWritten", "text": "Rows Written", "type": "number" }],
    "time_limit": 100000
})

# D1 Database Storage (Limit: 5 GB = 5,368,709,120 bytes)
add_metric_four_pack({
    "stat_title": "D1 - Total Database Storage",
    "gauge_title": "D1 - Storage vs Free Limit (5 GB)",
    "bar_title": "D1 - Storage by Database",
    "time_title": "D1 - Database Size Trend Over Time",
    "description": "D1 Storage consumption (Free tier: 5 GB included per account)",
    "unit": "bytes",
    "limit": 5368709120,
    "limit_label": "5 GB Free",
    "total_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { d1: d1AnalyticsAdaptiveGroups(limit: 10, orderBy: [date_DESC], filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}"}) { dimensions { databaseId } max { databaseSizeBytes } } } } }',
    "total_root": "data.viewer.accounts[0].d1",
    "total_cols": [{ "selector": "max.databaseSizeBytes", "text": "Storage Size", "type": "number" }],
    "stat_calc": "sum",
    "gauge_calc": "sum",
    "breakdown_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { d1: d1AnalyticsAdaptiveGroups(limit: 1000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}"}) { dimensions { databaseId date } max { databaseSizeBytes } } } } }',
    "breakdown_root": "data.viewer.accounts[0].d1",
    "breakdown_cols": [{ "selector": "dimensions.date", "text": "Date", "type": "string" }, { "selector": "dimensions.databaseId", "text": "Database", "type": "string" }, { "selector": "max.databaseSizeBytes", "text": "Storage", "type": "number" }],
    "x_field": "Date",
    "partition_field": "Database",
    "bar_limit": 5368709120,
    "timeseries_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { d1: d1AnalyticsAdaptiveGroups(orderBy: [datetimeHour_ASC], limit: 10000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}"}) { dimensions { databaseId time: datetimeHour } max { databaseSizeBytes } } } } }',
    "timeseries_root": "data.viewer.accounts[0].d1",
    "timeseries_cols": [{ "selector": "dimensions.time", "text": "Time", "type": "timestamp" }, { "selector": "dimensions.databaseId", "text": "Database", "type": "string" }, { "selector": "max.databaseSizeBytes", "text": "Storage", "type": "number" }],
    "time_limit": 5368709120
})

# D1 Queries & Execution Time
add_metric_four_pack({
    "stat_title": "D1 - Total Query Executions",
    "gauge_title": "D1 - Read vs Write Queries Ratio",
    "bar_title": "D1 - Daily Queries by Database",
    "time_title": "D1 - Query Batch Execution Time (ms) & Volume",
    "description": "D1 Query throughput and response latency",
    "unit": "short",
    "limit": 10000000,
    "limit_label": "10M Queries",
    "total_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { d1: d1AnalyticsAdaptiveGroups(limit: 1000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}"}) { sum { readQueries writeQueries } } } } }',
    "total_root": "data.viewer.accounts[0].d1",
    "total_cols": [{ "selector": "sum.readQueries", "text": "Read Queries", "type": "number" }, { "selector": "sum.writeQueries", "text": "Write Queries", "type": "number" }],
    "stat_calc": "sum",
    "breakdown_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { d1: d1AnalyticsAdaptiveGroups(limit: 10000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}"}) { dimensions { databaseId date } sum { readQueries writeQueries } } } } }',
    "breakdown_root": "data.viewer.accounts[0].d1",
    "breakdown_cols": [{ "selector": "dimensions.date", "text": "Date", "type": "string" }, { "selector": "dimensions.databaseId", "text": "Database", "type": "string" }, { "selector": "sum.readQueries", "text": "Read Queries", "type": "number" }, { "selector": "sum.writeQueries", "text": "Write Queries", "type": "number" }],
    "x_field": "Date",
    "partition_field": "Database",
    "timeseries_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { d1: d1AnalyticsAdaptiveGroups(orderBy: [datetimeHour_ASC], limit: 10000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}"}) { dimensions { databaseId time: datetimeHour } sum { readQueries writeQueries queryBatchTimeMs } } } } }',
    "timeseries_root": "data.viewer.accounts[0].d1",
    "timeseries_cols": [{ "selector": "dimensions.time", "text": "Time", "type": "timestamp" }, { "selector": "dimensions.databaseId", "text": "Database", "type": "string" }, { "selector": "sum.readQueries", "text": "Read Queries", "type": "number" }, { "selector": "sum.writeQueries", "text": "Write Queries", "type": "number" }, { "selector": "sum.queryBatchTimeMs", "text": "Batch Time (ms)", "type": "number" }]
})

# ==========================================
# ROW 3: Cloudflare Durable Objects (DO)
# ==========================================
add_row("⚡ Cloudflare Durable Objects (DO - 起動数・ストレージ・WebSocket)")

# DO Requests / Invocations (Limit: 1,000,000 / month)
add_metric_four_pack({
    "stat_title": "DO - Total Requests / Invocations",
    "gauge_title": "DO - Invocations vs Monthly Limit (1M)",
    "bar_title": "DO - Daily Invocations by Script",
    "time_title": "DO - Invocations Over Time",
    "description": "Durable Objects requests and invocations (Free tier: 1M/mo included)",
    "unit": "short",
    "limit": 1000000,
    "limit_label": "1M / mo",
    "total_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { do: durableObjectsInvocationsAdaptiveGroups(limit: 1000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}"}) { sum { requests } } } } }',
    "total_root": "data.viewer.accounts[0].do",
    "total_cols": [{ "selector": "sum.requests", "text": "Total Requests", "type": "number" }],
    "stat_calc": "sum",
    "gauge_calc": "sum",
    "breakdown_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { do: durableObjectsInvocationsAdaptiveGroups(limit: 10000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}"}) { dimensions { scriptName date } sum { requests } } } } }',
    "breakdown_root": "data.viewer.accounts[0].do",
    "breakdown_cols": [{ "selector": "dimensions.date", "text": "Date", "type": "string" }, { "selector": "dimensions.scriptName", "text": "Script", "type": "string" }, { "selector": "sum.requests", "text": "Requests", "type": "number" }],
    "x_field": "Date",
    "partition_field": "Script",
    "bar_limit": 1000000,
    "timeseries_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { do: durableObjectsInvocationsAdaptiveGroups(orderBy: [datetimeHour_ASC], limit: 10000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}"}) { dimensions { scriptName time: datetimeHour } sum { requests } } } } }',
    "timeseries_root": "data.viewer.accounts[0].do",
    "timeseries_cols": [{ "selector": "dimensions.time", "text": "Time", "type": "timestamp" }, { "selector": "dimensions.scriptName", "text": "Script", "type": "string" }, { "selector": "sum.requests", "text": "Requests", "type": "number" }],
    "time_limit": 1000000
})

# DO Storage Operations (Limit: 1,000,000 units / month)
add_metric_four_pack({
    "stat_title": "DO - Storage Units (Read & Write)",
    "gauge_title": "DO - Storage Units vs Limit (1M/mo)",
    "bar_title": "DO - Daily Storage Read vs Write Units",
    "time_title": "DO - Storage Operations Over Time",
    "description": "Durable Objects persistent storage read/write units (1M units/mo included)",
    "unit": "short",
    "limit": 1000000,
    "limit_label": "1M Units / mo",
    "total_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { doStore: durableObjectsStorageGroups(limit: 1000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}"}) { sum { storageReadUnits storageWriteUnits } } } } }',
    "total_root": "data.viewer.accounts[0].doStore",
    "total_cols": [{ "selector": "sum.storageReadUnits", "text": "Read Units", "type": "number" }, { "selector": "sum.storageWriteUnits", "text": "Write Units", "type": "number" }],
    "stat_calc": "sum",
    "gauge_calc": "sum",
    "breakdown_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { doStore: durableObjectsStorageGroups(limit: 10000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}"}) { dimensions { date } sum { storageReadUnits storageWriteUnits } } } } }',
    "breakdown_root": "data.viewer.accounts[0].doStore",
    "breakdown_cols": [{ "selector": "dimensions.date", "text": "Date", "type": "string" }, { "selector": "sum.storageReadUnits", "text": "Read Units", "type": "number" }, { "selector": "sum.storageWriteUnits", "text": "Write Units", "type": "number" }],
    "x_field": "Date",
    "timeseries_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { doStore: durableObjectsStorageGroups(orderBy: [datetimeHour_ASC], limit: 10000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}"}) { dimensions { time: datetimeHour } sum { storageReadUnits storageWriteUnits } } } } }',
    "timeseries_root": "data.viewer.accounts[0].doStore",
    "timeseries_cols": [{ "selector": "dimensions.time", "text": "Time", "type": "timestamp" }, { "selector": "sum.storageReadUnits", "text": "Read Units", "type": "number" }, { "selector": "sum.storageWriteUnits", "text": "Write Units", "type": "number" }]
})

# DO Stored Data Size (Limit: 1 GB = 1,073,741,824 bytes)
add_metric_four_pack({
    "stat_title": "DO - Total Stored Data Size",
    "gauge_title": "DO - Stored Data vs Limit (1 GB)",
    "bar_title": "DO - Stored Data by Script",
    "time_title": "DO - Stored Data Trend Over Time",
    "description": "Durable Objects persistent stored bytes (1 GB included)",
    "unit": "bytes",
    "limit": 1073741824,
    "limit_label": "1 GB Included",
    "total_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { doStore: durableObjectsStorageGroups(limit: 1, orderBy: [date_DESC], filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}"}) { max { storedBytes } } } } }',
    "total_root": "data.viewer.accounts[0].doStore",
    "total_cols": [{ "selector": "max.storedBytes", "text": "Stored Bytes", "type": "number" }],
    "breakdown_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { doStore: durableObjectsStorageGroups(limit: 1000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}"}) { dimensions { date } max { storedBytes } } } } }',
    "breakdown_root": "data.viewer.accounts[0].doStore",
    "breakdown_cols": [{ "selector": "dimensions.date", "text": "Date", "type": "string" }, { "selector": "max.storedBytes", "text": "Stored Bytes", "type": "number" }],
    "x_field": "Date",
    "bar_limit": 1073741824,
    "timeseries_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { doStore: durableObjectsStorageGroups(orderBy: [datetimeHour_ASC], limit: 10000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}"}) { dimensions { time: datetimeHour } max { storedBytes } } } } }',
    "timeseries_root": "data.viewer.accounts[0].doStore",
    "timeseries_cols": [{ "selector": "dimensions.time", "text": "Time", "type": "timestamp" }, { "selector": "max.storedBytes", "text": "Stored Bytes", "type": "number" }],
    "time_limit": 1073741824
})

# ==========================================
# ROW 4: Cloudflare Workers
# ==========================================
add_row("⚙️ Cloudflare Workers (実行数・CPU 時間・サブリクエスト・エラー)")

# Workers Requests (Limit: 100,000 / day)
add_metric_four_pack({
    "stat_title": "Workers - Total Invocations",
    "gauge_title": "Workers - Requests vs Daily Limit (100k)",
    "bar_title": "Workers - Daily Invocations by Script",
    "time_title": "Workers - Invocations Over Time",
    "description": "Cloudflare Workers invocations (Free tier: 100k requests/day included)",
    "unit": "short",
    "limit": 100000,
    "limit_label": "100k / day",
    "total_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { workers: workersInvocationsAdaptive(limit: 10, filter: {datetime_geq: "${__from:date:YYYY-MM-DD}T00:00:00Z", datetime_leq: "${__to:date:YYYY-MM-DD}T23:59:59Z"}) { sum { requests } } } } }',
    "total_root": "data.viewer.accounts[0].workers",
    "total_cols": [{ "selector": "sum.requests", "text": "Total Requests", "type": "number" }],
    "stat_calc": "sum",
    "gauge_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { workers: workersInvocationsAdaptive(limit: 1, orderBy: [datetime_DESC], filter: {datetime_geq: "${__from:date:YYYY-MM-DD}T00:00:00Z", datetime_leq: "${__to:date:YYYY-MM-DD}T23:59:59Z"}) { dimensions { datetime } sum { requests } } } } }',
    "gauge_root": "data.viewer.accounts[0].workers",
    "gauge_cols": [{ "selector": "sum.requests", "text": "Today Requests", "type": "number" }],
    "breakdown_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { workers: workersInvocationsAdaptive(limit: 10000, filter: {datetime_geq: "${__from:date:YYYY-MM-DD}T00:00:00Z", datetime_leq: "${__to:date:YYYY-MM-DD}T23:59:59Z"}) { dimensions { scriptName date: datetime } sum { requests } } } } }',
    "breakdown_root": "data.viewer.accounts[0].workers",
    "breakdown_cols": [{ "selector": "dimensions.date", "text": "Date", "type": "string" }, { "selector": "dimensions.scriptName", "text": "Script", "type": "string" }, { "selector": "sum.requests", "text": "Requests", "type": "number" }],
    "x_field": "Date",
    "partition_field": "Script",
    "bar_limit": 100000,
    "timeseries_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { workers: workersInvocationsAdaptive(orderBy: [datetime_ASC], limit: 10000, filter: {datetime_geq: "${__from:date:YYYY-MM-DD}T00:00:00Z", datetime_leq: "${__to:date:YYYY-MM-DD}T23:59:59Z"}) { dimensions { scriptName time: datetime } sum { requests } } } } }',
    "timeseries_root": "data.viewer.accounts[0].workers",
    "timeseries_cols": [{ "selector": "dimensions.time", "text": "Time", "type": "timestamp" }, { "selector": "dimensions.scriptName", "text": "Script", "type": "string" }, { "selector": "sum.requests", "text": "Requests", "type": "number" }],
    "time_limit": 100000
})

# Workers CPU Time (Limit: 10 ms / request)
add_metric_four_pack({
    "stat_title": "Workers - Median CPU Time",
    "gauge_title": "Workers - CPU Time vs Free Limit (10ms)",
    "bar_title": "Workers - Median CPU Time by Script",
    "time_title": "Workers - CPU Time Trend (p50 & p99)",
    "description": "Worker execution CPU time (Free tier limit: 10ms CPU time/request)",
    "unit": "ms",
    "limit": 10,
    "limit_label": "10ms / req",
    "total_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { workers: workersInvocationsAdaptive(limit: 10, filter: {datetime_geq: "${__from:date:YYYY-MM-DD}T00:00:00Z", datetime_leq: "${__to:date:YYYY-MM-DD}T23:59:59Z"}) { quantiles { cpuTimeP50 cpuTimeP99 } } } } }',
    "total_root": "data.viewer.accounts[0].workers",
    "total_cols": [{ "selector": "quantiles.cpuTimeP50", "text": "CPU P50 (ms)", "type": "number" }, { "selector": "quantiles.cpuTimeP99", "text": "CPU P99 (ms)", "type": "number" }],
    "breakdown_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { workers: workersInvocationsAdaptive(limit: 1000, filter: {datetime_geq: "${__from:date:YYYY-MM-DD}T00:00:00Z", datetime_leq: "${__to:date:YYYY-MM-DD}T23:59:59Z"}) { dimensions { scriptName date: datetime } quantiles { cpuTimeP50 } } } } }',
    "breakdown_root": "data.viewer.accounts[0].workers",
    "breakdown_cols": [{ "selector": "dimensions.date", "text": "Date", "type": "string" }, { "selector": "dimensions.scriptName", "text": "Script", "type": "string" }, { "selector": "quantiles.cpuTimeP50", "text": "CPU P50 (ms)", "type": "number" }],
    "x_field": "Date",
    "partition_field": "Script",
    "bar_limit": 10,
    "timeseries_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { workers: workersInvocationsAdaptive(orderBy: [datetime_ASC], limit: 10000, filter: {datetime_geq: "${__from:date:YYYY-MM-DD}T00:00:00Z", datetime_leq: "${__to:date:YYYY-MM-DD}T23:59:59Z"}) { dimensions { time: datetime } quantiles { cpuTimeP50 cpuTimeP99 } } } } }',
    "timeseries_root": "data.viewer.accounts[0].workers",
    "timeseries_cols": [{ "selector": "dimensions.time", "text": "Time", "type": "timestamp" }, { "selector": "quantiles.cpuTimeP50", "text": "CPU P50 (ms)", "type": "number" }, { "selector": "quantiles.cpuTimeP99", "text": "CPU P99 (ms)", "type": "number" }],
    "time_limit": 10
})

# Workers Wide Panels: Subrequests & Errors
if True:
    w_sub_target = target(
        'A',
        'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { workers: workersInvocationsAdaptive(orderBy: [datetime_ASC], limit: 10000, filter: {datetime_geq: "${__from:date:YYYY-MM-DD}T00:00:00Z", datetime_leq: "${__to:date:YYYY-MM-DD}T23:59:59Z"}) { dimensions { scriptName time: datetime } sum { subrequests } } } } }',
        'data.viewer.accounts[0].workers',
        [{ "selector": "dimensions.time", "text": "Time", "type": "timestamp" }, { "selector": "dimensions.scriptName", "text": "Script", "type": "string" }, { "selector": "sum.subrequests", "text": "Subrequests", "type": "number" }]
    )
    p_sub = timeseries_panel(
        title="Workers - Subrequests (fetch / external APIs) Over Time",
        description="Workers external HTTP calls and subrequests by script",
        grid_pos={ "x": 0, "y": current_y, "w": 12, "h": 8 },
        unit="short",
        targets=[w_sub_target],
        partition_field="Script"
    )

    w_err_target = target(
        'A',
        'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { workers: workersInvocationsAdaptive(orderBy: [datetime_ASC], limit: 10000, filter: {datetime_geq: "${__from:date:YYYY-MM-DD}T00:00:00Z", datetime_leq: "${__to:date:YYYY-MM-DD}T23:59:59Z"}) { dimensions { scriptName time: datetime } sum { errors } } } } }',
        'data.viewer.accounts[0].workers',
        [{ "selector": "dimensions.time", "text": "Time", "type": "timestamp" }, { "selector": "dimensions.scriptName", "text": "Script", "type": "string" }, { "selector": "sum.errors", "text": "Errors", "type": "number" }]
    )
    p_err = timeseries_panel(
        title="Workers - Errors & Exceptions Over Time",
        description="Workers unhandled exceptions and runtime errors by script",
        grid_pos={ "x": 12, "y": current_y, "w": 12, "h": 8 },
        unit="short",
        targets=[w_err_target],
        partition_field="Script"
    )
    panels.extend([p_sub, p_err])
    current_y += 8

# ==========================================
# ROW 5: Cloudflare Images & Assets / Edge CDN
# ==========================================
add_row("🖼️ Cloudflare Images & Assets / Edge CDN (画像配信・静的アセット・キャッシュ・帯域)")

# Images Delivered (Limit: 100,000 / month)
add_metric_four_pack({
    "stat_title": "Images - Total Delivered",
    "gauge_title": "Images - Delivered vs Monthly Limit (100k)",
    "bar_title": "Images - Daily Requests",
    "time_title": "Images - Delivered Over Time",
    "description": "Cloudflare Images served transformations and requests (100k/mo included)",
    "unit": "short",
    "limit": 100000,
    "limit_label": "100k / mo",
    "total_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { images: imagesRequestsAdaptiveGroups(limit: 1000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}"}) { sum { requests } } } } }',
    "total_root": "data.viewer.accounts[0].images",
    "total_cols": [{ "selector": "sum.requests", "text": "Total Requests", "type": "number" }],
    "stat_calc": "sum",
    "gauge_calc": "sum",
    "breakdown_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { images: imagesRequestsAdaptiveGroups(limit: 1000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}"}) { dimensions { date } sum { requests } } } } }',
    "breakdown_root": "data.viewer.accounts[0].images",
    "breakdown_cols": [{ "selector": "dimensions.date", "text": "Date", "type": "string" }, { "selector": "sum.requests", "text": "Requests", "type": "number" }],
    "x_field": "Date",
    "bar_limit": 100000,
    "timeseries_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { images: imagesRequestsAdaptiveGroups(orderBy: [datetimeHour_ASC], limit: 10000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}"}) { dimensions { time: datetimeHour } sum { requests } } } } }',
    "timeseries_root": "data.viewer.accounts[0].images",
    "timeseries_cols": [{ "selector": "dimensions.time", "text": "Time", "type": "timestamp" }, { "selector": "sum.requests", "text": "Requests", "type": "number" }],
    "time_limit": 100000
})

# CDN Wide Panels: Cache Status & Bandwidth
if True:
    cdn_cache_target = target(
        'A',
        'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { traffic: httpRequestsAdaptiveGroups(orderBy: [datetimeHour_ASC], limit: 10000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}"}) { dimensions { time: datetimeHour cacheStatus } sum { requests } } } } }',
        'data.viewer.accounts[0].traffic',
        [{ "selector": "dimensions.time", "text": "Time", "type": "timestamp" }, { "selector": "sum.requests", "text": "Requests", "type": "number" }, { "selector": "dimensions.cacheStatus", "text": "Cache Status", "type": "string" }]
    )
    p_cache = timeseries_panel(
        title="CDN - HTTP Requests by Cache Status (Edge Hit / Miss / Bypass)",
        description="Edge caching status for static assets and HTML pages",
        grid_pos={ "x": 0, "y": current_y, "w": 12, "h": 8 },
        unit="short",
        targets=[cdn_cache_target],
        partition_field="Cache Status"
    )

    cdn_bytes_target = target(
        'A',
        'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { traffic: httpRequestsAdaptiveGroups(orderBy: [datetimeHour_ASC], limit: 10000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}"}) { dimensions { time: datetimeHour } sum { bytes } } } } }',
        'data.viewer.accounts[0].traffic',
        [{ "selector": "dimensions.time", "text": "Time", "type": "timestamp" }, { "selector": "sum.bytes", "text": "Bandwidth", "type": "number" }]
    )
    p_bytes = timeseries_panel(
        title="CDN - Edge Data Transfer & Bandwidth (Bytes) Over Time",
        description="Total egress data transferred from Cloudflare edge nodes",
        grid_pos={ "x": 12, "y": current_y, "w": 12, "h": 8 },
        unit="decbytes",
        targets=[cdn_bytes_target]
    )
    panels.extend([p_cache, p_bytes])
    current_y += 8

# ==========================================
# ROW 6: Workers KV (Key-Value Storage)
# ==========================================
add_row("🗃️ Workers KV (Key-Value Storage - 読み込み・書き込み・容量)")

# KV Reads (Limit: 100,000 / day)
add_metric_four_pack({
    "stat_title": "KV - Total Read Operations",
    "gauge_title": "KV - Reads vs Daily Limit (100k)",
    "bar_title": "KV - Daily Reads by Namespace",
    "time_title": "KV - Read Operations Over Time",
    "description": "Workers KV read operations (Free tier: 100k/day included)",
    "unit": "short",
    "limit": 100000,
    "limit_label": "100k / day",
    "total_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { kv: kvOperationsAdaptiveGroups(limit: 10000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}", actionType: "read"}) { sum { requests } } } } }',
    "total_root": "data.viewer.accounts[0].kv",
    "total_cols": [{ "selector": "sum.requests", "text": "Total Reads", "type": "number" }],
    "stat_calc": "sum",
    "gauge_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { kv: kvOperationsAdaptiveGroups(limit: 1, orderBy: [date_DESC], filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}", actionType: "read"}) { dimensions { date } sum { requests } } } } }',
    "gauge_root": "data.viewer.accounts[0].kv",
    "gauge_cols": [{ "selector": "sum.requests", "text": "Today Reads", "type": "number" }],
    "breakdown_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { kv: kvOperationsAdaptiveGroups(limit: 1000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}", actionType: "read"}) { dimensions { date namespaceId } sum { requests } } } } }',
    "breakdown_root": "data.viewer.accounts[0].kv",
    "breakdown_cols": [{ "selector": "dimensions.date", "text": "Date", "type": "string" }, { "selector": "dimensions.namespaceId", "text": "Namespace", "type": "string" }, { "selector": "sum.requests", "text": "Requests", "type": "number" }],
    "x_field": "Date",
    "partition_field": "Namespace",
    "bar_limit": 100000,
    "timeseries_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { kv: kvOperationsAdaptiveGroups(orderBy: [datetimeHour_ASC], limit: 10000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}", actionType: "read"}) { dimensions { time: datetimeHour namespaceId } sum { requests } } } } }',
    "timeseries_root": "data.viewer.accounts[0].kv",
    "timeseries_cols": [{ "selector": "dimensions.time", "text": "Time", "type": "timestamp" }, { "selector": "dimensions.namespaceId", "text": "Namespace", "type": "string" }, { "selector": "sum.requests", "text": "Requests", "type": "number" }],
    "time_limit": 100000
})

# KV Writes (Limit: 1,000 / day)
add_metric_four_pack({
    "stat_title": "KV - Total Write Operations",
    "gauge_title": "KV - Writes vs Daily Limit (1k)",
    "bar_title": "KV - Daily Writes by Namespace",
    "time_title": "KV - Write Operations Over Time",
    "description": "Workers KV write operations (Free tier: 1k/day included)",
    "unit": "short",
    "limit": 1000,
    "limit_label": "1k / day",
    "total_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { kv: kvOperationsAdaptiveGroups(limit: 10000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}", actionType: "write"}) { sum { requests } } } } }',
    "total_root": "data.viewer.accounts[0].kv",
    "total_cols": [{ "selector": "sum.requests", "text": "Total Writes", "type": "number" }],
    "stat_calc": "sum",
    "gauge_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { kv: kvOperationsAdaptiveGroups(limit: 1, orderBy: [date_DESC], filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}", actionType: "write"}) { dimensions { date } sum { requests } } } } }',
    "gauge_root": "data.viewer.accounts[0].kv",
    "gauge_cols": [{ "selector": "sum.requests", "text": "Today Writes", "type": "number" }],
    "breakdown_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { kv: kvOperationsAdaptiveGroups(limit: 1000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}", actionType: "write"}) { dimensions { date namespaceId } sum { requests } } } } }',
    "breakdown_root": "data.viewer.accounts[0].kv",
    "breakdown_cols": [{ "selector": "dimensions.date", "text": "Date", "type": "string" }, { "selector": "dimensions.namespaceId", "text": "Namespace", "type": "string" }, { "selector": "sum.requests", "text": "Requests", "type": "number" }],
    "x_field": "Date",
    "partition_field": "Namespace",
    "bar_limit": 1000,
    "timeseries_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { kv: kvOperationsAdaptiveGroups(orderBy: [datetimeHour_ASC], limit: 10000, filter: {date_geq: "${__from:date:YYYY-MM-DD}", date_leq: "${__to:date:YYYY-MM-DD}", actionType: "write"}) { dimensions { time: datetimeHour namespaceId } sum { requests } } } } }',
    "timeseries_root": "data.viewer.accounts[0].kv",
    "timeseries_cols": [{ "selector": "dimensions.time", "text": "Time", "type": "timestamp" }, { "selector": "dimensions.namespaceId", "text": "Namespace", "type": "string" }, { "selector": "sum.requests", "text": "Requests", "type": "number" }],
    "time_limit": 1000
})

# ==========================================
# ROW 7: Cloudflare Queues & Messaging
# ==========================================
add_row("📬 Cloudflare Queues & Messaging (キュー操作・メッセージ数)")

# Queues Operations (Limit: 1,000,000 / month)
add_metric_four_pack({
    "stat_title": "Queues - Total Operations",
    "gauge_title": "Queues - Operations vs Limit (1M/mo)",
    "bar_title": "Queues - Daily Operations by Queue",
    "time_title": "Queues - Operations Over Time",
    "description": "Cloudflare Queues operations (1M operations/month included)",
    "unit": "short",
    "limit": 1000000,
    "limit_label": "1M / mo",
    "total_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { queues: queueMessageOperationsAdaptiveGroups(limit: 1000, filter: {datetime_geq: "${__from:date:YYYY-MM-DD}T00:00:00Z", datetime_leq: "${__to:date:YYYY-MM-DD}T23:59:59Z"}) { sum { billableOperations } } } } }',
    "total_root": "data.viewer.accounts[0].queues",
    "total_cols": [{ "selector": "sum.billableOperations", "text": "Total Operations", "type": "number" }],
    "stat_calc": "sum",
    "gauge_calc": "sum",
    "breakdown_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { queues: queueMessageOperationsAdaptiveGroups(limit: 1000, filter: {datetime_geq: "${__from:date:YYYY-MM-DD}T00:00:00Z", datetime_leq: "${__to:date:YYYY-MM-DD}T23:59:59Z"}) { dimensions { datetimeHour queueId } sum { billableOperations } } } } }',
    "breakdown_root": "data.viewer.accounts[0].queues",
    "breakdown_cols": [{ "selector": "dimensions.datetimeHour", "text": "Date", "type": "string" }, { "selector": "dimensions.queueId", "text": "Queue", "type": "string" }, { "selector": "sum.billableOperations", "text": "Operations", "type": "number" }],
    "x_field": "Date",
    "partition_field": "Queue",
    "bar_limit": 1000000,
    "timeseries_query": 'query { viewer { accounts(filter: {accountTag: "${accountTag}"}) { queues: queueMessageOperationsAdaptiveGroups(orderBy: [datetimeHour_ASC], limit: 10000, filter: {datetime_geq: "${__from:date:YYYY-MM-DD}T00:00:00Z", datetime_leq: "${__to:date:YYYY-MM-DD}T23:59:59Z"}) { dimensions { time: datetimeHour actionType } sum { billableOperations } } } } }',
    "timeseries_root": "data.viewer.accounts[0].queues",
    "timeseries_cols": [{ "selector": "dimensions.time", "text": "Time", "type": "timestamp" }, { "selector": "dimensions.actionType", "text": "Action", "type": "string" }, { "selector": "sum.billableOperations", "text": "Operations", "type": "number" }],
    "partition_field": "Action",
    "time_limit": 1000000
})

# ==========================================
# Dashboard Metadata & JSON Assembly
# ==========================================
dashboard = {
    "annotations": { "list": [] },
    "editable": True,
    "fiscalYearStartMonth": 0,
    "graphTooltip": 1,
    "id": None,
    "links": [],
    "liveNow": False,
    "panels": panels,
    "refresh": "1m",
    "schemaVersion": 39,
    "tags": ["cloudflare", "billing", "d1", "r2", "durable-objects", "workers", "images", "kv", "queues"],
    "templating": {
        "list": [
            {
                "current": { "selected": True, "text": "YOUR_CLOUDFLARE_ACCOUNT_TAG", "value": "YOUR_CLOUDFLARE_ACCOUNT_TAG" },
                "hide": 0,
                "label": "Account ID",
                "name": "accountTag",
                "options": [{ "selected": True, "text": "YOUR_CLOUDFLARE_ACCOUNT_TAG", "value": "YOUR_CLOUDFLARE_ACCOUNT_TAG" }],
                "query": "YOUR_CLOUDFLARE_ACCOUNT_TAG",
                "skipUrlSync": False,
                "type": "constant"
            },
            {
                "current": { "selected": True, "text": "yesoreyeram-infinity-datasource-cloudflare-graph-ql", "value": "yesoreyeram-infinity-datasource-cloudflare-graph-ql" },
                "hide": 0,
                "includeAll": False,
                "label": "Data Source",
                "multi": False,
                "name": "DS_CLOUDFLARE_GRAPHQL_DATA_SOURCE",
                "options": [],
                "query": "yesoreyeram-infinity-datasource",
                "refresh": 1,
                "regex": "",
                "skipUrlSync": False,
                "type": "datasource"
            },
            {
                "current": { "selected": False, "text": "", "value": "" },
                "hide": 2,
                "label": "Account Email (Optional Header)",
                "name": "accountEmail",
                "options": [{ "selected": True, "text": "", "value": "" }],
                "query": "",
                "skipUrlSync": False,
                "type": "textbox"
            },
            {
                "current": { "selected": False, "text": "", "value": "" },
                "hide": 2,
                "label": "API Key (Optional Header)",
                "name": "apiKey",
                "options": [{ "selected": True, "text": "", "value": "" }],
                "query": "",
                "skipUrlSync": False,
                "type": "textbox"
            }
        ]
    },
    "time": { "from": "now-30d", "to": "now" },
    "timepicker": {
        "refresh_intervals": ["30s", "1m", "5m", "15m", "30m", "1h", "2h", "1d"]
    },
    "timezone": "browser",
    "title": "Cloudflare Unified Billing & Resource Monitor",
    "uid": "cloudflare-unified-billing",
    "version": 1,
    "weekStart": ""
}

target_dir = os.path.dirname(os.path.abspath(__file__))
json_path = os.path.join(target_dir, "cloudflare-unified-dashboard.json")

with open(json_path, "w", encoding="utf-8") as f:
    json.dump(dashboard, f, ensure_ascii=False, indent=2)

print(f"Successfully generated {json_path}")
print(f"Total panels generated: {len(panels)}")
