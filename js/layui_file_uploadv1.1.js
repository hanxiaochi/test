var _curRequestPath  = window.document.location.href,
	_pathName = window.document.location.pathname,
	_ipAndPort = _curRequestPath.indexOf(_pathName),
	_localhostPath = _curRequestPath.substring(0,_ipAndPort),
	_projectName = _pathName.substring(0,_pathName.substr(1).indexOf('/')+1),
//	_basePath = _localhostPath + _projectName;//当前项目路径－本地运行
	_basePath = _localhostPath+"";			//当前项目路径－服务器运行
var attachmentTableId,attachmentArray=[],uploadListIns;
//id:主表id，type：附件表存储的type，tableBody：显示附件table，delBtnShow:是否显示删除按钮
function findAttachment(id,type,tableBody,delBtnShow){
	attachmentArray=[];
	var _html_ = '<div style="display: flex;justify-content: center;margin:20px;height:90%">';
	var _html1_ = '</div>';	
	if (id != "") {
		//异步请求计量单已有的草图信息 加载到页面
		$.ajax({
			url : "attachment_public/get_attachment_list",
			data : {
				"id" : id,
				"type" : type
			},
			type : "get",
			dataType : "json",
			async : false,
			success : function(result) {
				if (result.code == 1) {
					var accessList = result.data;
					for (var i = 0; i < accessList.length; i++) {
						var access = accessList[i];
						attachmentArray.push(access);
//						var downloadUrl = CommonUtil.webPath()+access.filePath+'/'+ access.fileName;
						var fileName = access.fileName.substring(0,access.fileName.lastIndexOf('(')) + 
						access.fileName.substring(access.fileName.lastIndexOf(')')+1,access.fileName.length);
						var fileTy=["jpg","jpeg","png","gif","txt","xls","xlsx","doc","docx","pdf"];
				        var tr = '<tr id="upload-'+ i +'">'+'<td>'+ fileName +'</td>';
						if(access.size==null||access.size==""){
							tr+='<td> </td>';
						}else{
							tr+='<td>'+ (access.size/1024).toFixed(1) +'kb</td>';
						}
//	       				tr+='<td>上传成功</td>';
	        			tr+='<td style="text-align: center;">';
	        			if(fileTy.indexOf(access.ext)!=-1){
	        				tr+='<button class="layui-btn layui-btn-xs layui-btn-normal demo-preview" data-url="'+access.filePath+"/"+access.realName+'" data-index="'+i+'">预览</button>';
	        			}
	        			//tr+='<button class="layui-btn layui-btn-xs demo-download" data-url="'+access.filePath+"/"+access.realName+'" data-index="'+i+'">下载</button>';
						tr += '<a class="layui-btn layui-btn-xs demo-download kv-file-download btn btn-sm btn-kv btn-default btn-outline-secondary" ' +
     'title="下载文件" ' +
     'href="' + _basePath+access.filePath + "/" + access.realName + '" ' +
     'download="' + access.realName + '" ' +
     'target="_blank">' +
     '下载' + 
     '</a>';

	        			if(delBtnShow){
				           tr+='<button class="layui-btn layui-btn-xs layui-btn-danger demo-delete" data-index="'+i+'">删除</button>';
	        			}
	        			tr+='</td>';
	        			tr+='</tr>';
			        	$(tableBody).append(tr);
					}
					$(tableBody).find('.demo-preview').on('click', function(){
							var href = _basePath +$(this).attr("data-url");
							var attFileType=$(this).attr("data-url").substring($(this).attr("data-url").lastIndexOf(".")+1,$(this).attr("data-url").length);
							var imgList = ["jpg","jpeg","png","gif"];
							var txtList = ["txt"];
							var officeList = ["xls","xlsx","doc","docx"];
							if(imgList.indexOf(attFileType)!=-1){
								var _html2 = '<div class="modal-body">'
						      		+'<div class="kv-zoom-body file-zoom-content krajee-default" style="height:550px">'
									+'<img src="'+href + '" style="width: auto; height: auto; max-width: 100%; max-height: 100%;">'
									+'</div>'
						  			+'</div>';
								showFile(_html2);
								return false;
							}
							if(txtList.indexOf(attFileType)!=-1){
								var _html0 = '<div>'+href+'</div>';
								var _html2 = _html_ + _html0 + _html1_;
						        showFile(_html2);
								return false;
							}
							if(officeList.indexOf(attFileType)!=-1){
								var url = CommonUtil.webPath()+encodeURI(encodeURI($(this).attr("data-url"))); //要预览文件的访问地址
								layer.open({
								  title:'预览文件',
								  area: ['70%', '80%'],
								  type: 2, 
								  content: 'https://preview.example.com/onlinePreview?url='+encodeURIComponent(Base64.encode(url))
								}); 
								//POBrowser.openWindowModeless(CommonUtil.webPath()+'/page_office/see_file?fileUrl='+encodeURI(encodeURI($(this).attr("data-url"))),'width=1200px;height=800px;');
								return false;
							}
							if(attFileType=="pdf"){
								parent.layer.open({
									type: 2,
									title:'预览文件',
									id:"previewAttachment",
									area: ['750px', '650px'],
									fixed: false, //不固定
									maxmin: false,
									content: "page_office/showPdf?realPath="+$(this).attr("data-url"),
								})
								return false;
							}
				        });
				        /*$(tableBody).find('.demo-download').on('click', function(){
							var href = _basePath +$(this).attr("data-url");
							alert(_basePath+"----"+$(this).attr("data-url"));
							alert(href);
							href="http://192.168.1.118:8081/upload/AttachmentPublic/112/1757496159896.docx";
							window.location.href = href;
				        });*/
				        $(tableBody).find('.demo-delete').on('click', function(){
				        	delete attachmentArray[ $(this).attr("data-index")]; //删除对应的文件
				        	$(this).parent().parent().remove();
				        });
				}
			}
		});
	}
	function showFile(html2){
		layui.use(['layer'],function() {
			layer.open({
				type: 1,
				title:'预览文件',
				id:"previewAttachment",
				area: ['750px', '650px'],
				fixed: false, //不固定
				maxmin:true,
				content: html2
			});
		})
	}
}
//初始化附件模块
//elemId:选择文件按钮id，tableCode：附件表存储的type，tableBody：显示附件table，fileType:选择上传文件类型
function renderFileUpload(elemId,tableBody,tableCode,fileType){
	layui.use(['upload', 'element', 'layer'], function(){
		var $ = layui.jquery
		,upload = layui.upload
		,element = layui.element;
		if(fileType==""){
			fileType="file";
		}
		uploadListIns = upload.render({
			elem: '#'+elemId
			,elemList: $(tableBody) //列表元素对象
			,url: 'attachment_public/upload_attachment_layui'
			,data:{
				id: function (){
  	    			return attachmentTableId;
  	    		},
				tableCode:tableCode
			}
			,accept: fileType
			,multiple: true
			,number: 15
			,auto: false
			,choose: function(obj){
				var that = this;
				var files = this.files = obj.pushFile(); //将每次选择的文件追加到文件队列
				//读取本地文件
				obj.preview(function(index, file, result){
					var tr = $(['<tr id="upload-'+ index +'">'
					,'<td>'+ file.name +'</td>'
					,'<td>'+ (file.size/1024).toFixed(1) +'kb</td>'
//					,'<td>等待上传</td>'
					,'<td style="text-align: center;">'
//					,'<button class="layui-btn layui-btn-xs demo-reload layui-hide">重传</button>'
					,'<button class="layui-btn layui-btn-xs layui-btn-danger demo-delete">删除</button>'
					,'</td>'
					,'</tr>'].join(''));
					//单个重传
					tr.find('.demo-reload').on('click', function(){
						obj.upload(index, file);
					});
					//删除
					tr.find('.demo-delete').on('click', function(){
						delete files[index]; //删除对应的文件
						tr.remove();
						uploadListIns.config.elem.next()[0].value = ''; //清空 input file 值，以免删除后出现同名文件不可选
					});
					that.elemList.append(tr);
					element.render('progress'); //渲染新加的进度条组件
				});
			}
			,done: function(res, index, upload){ //成功的回调
				var that = this;
				//if(res.code == 0){ //上传成功
				var tr = that.elemList.find('tr#upload-'+ index)
				,tds = tr.children();
				tds.eq(3).html(''); //清空操作
				delete this.files[index]; //删除文件队列已经上传成功的文件
				return;
				//}
//				this.error(index, upload);
			}
			,allDone: function(obj){ //多文件上传完毕后的状态回调
				console.log(obj)
			}
			,error: function(index, upload){ //错误回调
				var that = this;
				var tr = that.elemList.find('tr#upload-'+ index)
				,tds = tr.children();
				tds.eq(3).find('.demo-reload').removeClass('layui-hide'); //显示重传
			}
			,progress: function(n, elem, e, index){ //注意：index 参数为 layui 2.6.6 新增
				element.progress('progress-demo-'+ index, n + '%'); //执行进度条。n 即为返回的进度百分比
			}
		});
	})
}
//删除其他附件表数据
//tableCode:附件表存储的type
function deleteAttachment(tableCode){
	var ids = new Array();
	for(var i=0;i<attachmentArray.length;i++){
		if(typeof attachmentArray[i] != "undefined"){
			ids.push(attachmentArray[i].attachmentId);
		}
	}
	$.ajax({
		type : 'get',
		url : 'attachment_public/del_attachment_other',
		async : false,
		data : {
			attIds : ids.join(","),
			tableCode : tableCode,
			id :  function (){
    			return attachmentTableId;
    		}
		},
		dataType : 'json',
		success : function(res) {
			console.log(res.msg);
		}
	});
}