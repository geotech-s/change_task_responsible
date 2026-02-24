export default async function handler(req, res) {
  const startTime = Date.now();

  const log = (level, message, data = null) => {
    console.log(JSON.stringify({
      level,
      message,
      data,
      timestamp: new Date().toISOString()
    }));
  };

  try {
    log("info", "=== NEW REQUEST ===");

    // Логируем метод и headers
    log("info", "Request meta", {
      method: req.method,
      headers: req.headers
    });

    if (req.method !== "POST") {
      log("warn", "Invalid method");
      return res.status(405).json({ error: "Method not allowed" });
    }

    // Логируем raw body
    log("info", "Raw body received", req.body);

    // ===== Парсинг body
    let body = req.body;

    if (typeof body === "string") {
      try {
        body = Object.fromEntries(new URLSearchParams(body));
        log("info", "Body parsed from string", body);
      } catch (e) {
        log("error", "Failed to parse body string", e.message);
      }
    }

    // ===== Извлекаем document_id
    const doc0 = body["document_id[0]"];
    const doc1 = body["document_id[1]"];
    const doc2 = body["document_id[2]"];

    log("info", "Parsed document_id fields", {
      doc0,
      doc1,
      doc2
    });

    const taskId = doc2;

    if (!taskId) {
      log("error", "BITRIX_BLOCKED_OR_INVALID_PAYLOAD", body);
      return res.status(400).json({ error: "Task ID missing" });
    }

    log("info", "Processing task", { taskId });

    // ===== Вебхуки Bitrix
    const TASK_GET_URL =
      "https://geotech-s.bitrix24.ru/rest/70/66t0oshgppeew1kj/task.item.getdata.json";

    const LEAD_GET_URL =
      "https://geotech-s.bitrix24.ru/rest/70/333ed15kcwzis04q/crm.lead.get.json";

    const TASK_UPDATE_URL =
      "https://geotech-s.bitrix24.ru/rest/70/1b0uh8asry7b449d/task.item.update.json";

    // =============================
    // Получаем задачу
    // =============================
    log("info", "Requesting task data");

    const taskResponse = await fetch(TASK_GET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ taskId })
    });

    const taskData = await taskResponse.json();
    log("info", "Task response", taskData);

    if (!taskData.result) {
      log("error", "Task not found or invalid response", taskData);
      return res.status(404).json({ error: "Task not found" });
    }

    const task = taskData.result;

    if (!task.UF_CRM_TASK || task.UF_CRM_TASK.length === 0) {
      log("info", "Task has no CRM binding");
      return res.status(200).json({ success: true, message: "No CRM binding" });
    }

    const crmBinding = task.UF_CRM_TASK[0];

    if (!crmBinding.startsWith("L_")) {
      log("info", "CRM binding is not a lead", { crmBinding });
      return res.status(200).json({ success: true, message: "Not a lead binding" });
    }

    const leadId = crmBinding.replace("L_", "");
    log("info", "Lead detected", { leadId });

    // =============================
    // Получаем лид
    // =============================
    log("info", "Requesting lead data");

    const leadResponse = await fetch(LEAD_GET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id: leadId })
    });

    const leadData = await leadResponse.json();
    log("info", "Lead response", leadData);

    if (!leadData.result) {
      log("error", "Lead not found or invalid response", leadData);
      return res.status(404).json({ error: "Lead not found" });
    }

    const newResponsibleId = leadData.result.ASSIGNED_BY_ID;
    log("info", "Responsible from lead", { newResponsibleId });

    if (!newResponsibleId) {
      log("error", "Lead has no ASSIGNED_BY_ID");
      return res.status(400).json({ error: "Lead has no responsible" });
    }

    // Если уже совпадает
    if (String(task.RESPONSIBLE_ID) === String(newResponsibleId)) {
      log("info", "Responsible already synced");
      return res.status(200).json({ success: true, message: "Already synced" });
    }

    // =============================
    // Обновляем задачу
    // =============================
    log("info", "Updating task responsible");

    const updateResponse = await fetch(TASK_UPDATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        taskId,
        "fields[RESPONSIBLE_ID]": String(newResponsibleId)
      })
    });

    const updateData = await updateResponse.json();
    log("info", "Update response", updateData);

    if (updateData.error) {
      log("error", "Task update failed", updateData);
      return res.status(500).json({ error: "Update failed", details: updateData });
    }

    log("info", "Task updated successfully", {
      taskId,
      newResponsibleId,
      durationMs: Date.now() - startTime
    });

    return res.status(200).json({
      success: true,
      taskId,
      newResponsibleId
    });

  } catch (error) {
    log("fatal", "Unhandled exception", {
      message: error.message,
      stack: error.stack
    });

    return res.status(500).json({ error: "Internal server error" });
  }
}
