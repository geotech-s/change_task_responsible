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

    // ✅ Правильный разбор form-data от Bitrix
    const taskId = req.body["document_id[2]"];
    const restEndpoint = req.body["auth[client_endpoint]"];
    const memberId = req.body["auth[member_id]"];

    if (!taskId || !restEndpoint) {
      log("error", "Invalid payload structure", req.body);
      return res.status(400).json({ error: "Invalid payload" });
    }

    log("info", "Processing task", { taskId, memberId });

    // =============================
    // 1️⃣ Получаем задачу
    // =============================

    const taskResponse = await fetch(
      `${restEndpoint}task.item.getdata.json`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ taskId })
      }
    );

    const taskData = await taskResponse.json();

    if (!taskData.result) {
      log("error", "Task not found", taskData);
      return res.status(404).json({ error: "Task not found" });
    }

    const task = taskData.result;

    if (!task.UF_CRM_TASK || !task.UF_CRM_TASK.length) {
      log("info", "No CRM binding");
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
    // 2️⃣ Получаем лид
    // =============================

    const leadResponse = await fetch(
      `${restEndpoint}crm.lead.get.json`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ id: leadId })
      }
    );

    const leadData = await leadResponse.json();

    if (!leadData.result) {
      log("error", "Lead not found", leadData);
      return res.status(404).json({ error: "Lead not found" });
    }

    const newResponsibleId = leadData.result.ASSIGNED_BY_ID;

    log("info", "Responsible from lead", { newResponsibleId });

    // Если уже совпадает — не обновляем
    if (String(task.RESPONSIBLE_ID) === String(newResponsibleId)) {
      log("info", "Responsible already correct");
      return res.status(200).json({ success: true, message: "Already synced" });
    }

    // =============================
    // 3️⃣ Обновляем задачу
    // =============================

    const updateResponse = await fetch(
      `${restEndpoint}task.item.update.json`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          taskId,
          "fields[RESPONSIBLE_ID]": newResponsibleId
        })
      }
    );

    const updateData = await updateResponse.json();

    if (!updateData.result) {
      log("error", "Update failed", updateData);
      return res.status(500).json({ error: "Update failed" });
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
    console.error(JSON.stringify({
      level: "fatal",
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    }));

    return res.status(500).json({ error: "Internal server error" });
  }
}
