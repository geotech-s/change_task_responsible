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
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    log("info", "Raw body received", req.body);

    // =============================
    // Получаем ID задачи из webhook БП
    // =============================
    const taskId = req.body["document_id[2]"];

    if (!taskId) {
      log("error", "Task ID not found in payload", req.body);
      return res.status(400).json({ error: "Task ID missing" });
    }

    log("info", "Processing task", { taskId });

    // =============================
    // ВЕБХУКИ
    // =============================
    const TASK_GET_URL =
      "https://geotech-s.bitrix24.ru/rest/66/ugbjhxzk2388u5yr/task.item.getdata.json";

    const LEAD_GET_URL =
      "https://geotech-s.bitrix24.ru/rest/66/kbs41wsjh3bjgiqs/crm.lead.get.json";

    const TASK_UPDATE_URL =
      "https://geotech-s.bitrix24.ru/rest/66/i3rbogjfcwq69wum/task.item.update.json";

    // =============================
    // Получаем задачу
    // =============================
    const taskResponse = await fetch(TASK_GET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ taskId })
    });

    const taskData = await taskResponse.json();

    if (!taskData.result) {
      log("error", "Task not found", taskData);
      return res.status(404).json({ error: "Task not found", details: taskData });
    }

    const task = taskData.result;

    if (!task.UF_CRM_TASK || task.UF_CRM_TASK.length === 0) {
      log("info", "Task has no CRM binding");
      return res.status(200).json({ success: true, message: "No CRM binding" });
    }

    const crmBinding = task.UF_CRM_TASK[0];

    if (!crmBinding.startsWith("L_")) {
      log("info", "Binding is not a lead", { crmBinding });
      return res.status(200).json({ success: true, message: "Not a lead binding" });
    }

    const leadId = crmBinding.replace("L_", "");
    log("info", "Lead detected", { leadId });

    // =============================
    // Получаем лид
    // =============================
    const leadResponse = await fetch(LEAD_GET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id: leadId })
    });

    const leadData = await leadResponse.json();

    if (!leadData.result) {
      log("error", "Lead not found", leadData);
      return res.status(404).json({ error: "Lead not found", details: leadData });
    }

    const newResponsibleId = leadData.result.ASSIGNED_BY_ID;
    log("info", "Responsible from lead", { newResponsibleId });

    // Если уже совпадает — ничего не делаем
    if (String(task.RESPONSIBLE_ID) === String(newResponsibleId)) {
      log("info", "Responsible already correct");
      return res.status(200).json({ success: true, message: "Already synced" });
    }

    // =============================
    // Обновляем задачу
    // =============================
    const updateResponse = await fetch(TASK_UPDATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        taskId,
        "fields[RESPONSIBLE_ID]": String(newResponsibleId)
      })
    });

    const updateData = await updateResponse.json();

    // Новая проверка: если есть error — считаем неудачей
    if (updateData.error) {
      log("error", "Task update failed", updateData);
      return res.status(500).json({ error: "Update failed", details: updateData });
    }

    // Иначе считаем успешным, даже если result=null
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
    console.error(JSON.stringify({
      level: "fatal",
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    }));
    return res.status(500).json({ error: "Internal server error" });
  }
}
